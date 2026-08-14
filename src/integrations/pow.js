import { getRobloxUserId, getRobloxUserIdExact } from './prc.js';
import { getStaffLink, setStaffLink } from '../tenant/store.js';
import { assertPublicHttpUrlCached, ssrfAgent } from '../ai/ssrf.js';
import { externalApiDuration } from '../metrics.js';

// Per the POW Developer API docs (powdocs.atriasafety.org/advanced-features/developer-api),
// the public API is served under /api/public/v1 — not bare /api — and each API
// key is scoped to a single server, so no server ID needs to be sent.
function baseUrl(tenantCtx) {
  return tenantCtx.tenant.powBaseUrl || 'https://pow.atriasafety.org/api/public/v1';
}

// The base URL is tenant-configurable, so validate it points at a public host
// before sending the tenant's POW token to it (SSRF guard).
async function guardedFetch(urlStr, opts) {
  await assertPublicHttpUrlCached(urlStr);
  const __start = Date.now();
  // Pin the socket to a connect-time-validated address (DNS-rebind defence).
  const res = await fetch(urlStr, { ...opts, dispatcher: ssrfAgent });
  externalApiDuration.observe({ service: 'pow', status: res.ok ? 'ok' : 'error' }, (Date.now() - __start) / 1000);
  return res;
}

function token(tenantCtx) {
  if (!tenantCtx.tenant.powToken) {
    throw new Error('CRITICAL API KEY ERROR: Tenant has no POW token configured. You must flag this to higher-ups/server owner immediately so they can set it in /wren config under Secrets.');
  }
  return tenantCtx.tenant.powToken;
}

export async function getPunishments(tenantCtx, username) {
  const userInfo = await getRobloxUserId(tenantCtx, username);
  if (!userInfo) throw new Error(`Could not find Roblox user: ${username}`);
  const results = { username: userInfo.username, userId: userInfo.userId, punishments: [] };
  const res = await guardedFetch(`${baseUrl(tenantCtx)}/punishments?userId=${userInfo.userId}`, {
    headers: { 'Authorization': `Bearer ${token(tenantCtx)}` },
  });
  // A non-OK response must throw, not read as "no punishments" — a broken/
  // expired POW token would otherwise make check_punishments confidently
  // report a clean record for a player who may have one.
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`[pow] /punishments failed for Roblox ID ${userInfo.userId}: HTTP ${res.status} ${text.slice(0, 200)}`);
    throw new Error(`POW punishment lookup error ${res.status}: ${text.slice(0, 200)}`);
  }
  // GET /punishments returns a bare array of Punishment records, not a wrapper object.
  const json = await res.json();
  for (const p of Array.isArray(json) ? json : []) {
    results.punishments.push(p);
  }
  return results;
}

// Resolves a Discord moderator's Roblox User ID for the POW `moderatorId` field.
// Verified once by checking that the Roblox account they claim is listed in POW's
// own staff directory (/members/lookup) as linked to *their* Discord ID — this
// stops one staff member from logging punishments under another's Roblox identity.
// Once verified, the mapping is cached in tenant_staff_links permanently, so the
// moderator is only ever asked for their Roblox username the first time.
async function resolveModeratorId(tenantCtx, moderatorDiscordId, moderatorRobloxUsername) {
  const cached = await getStaffLink({ tenantId: tenantCtx.tenant.tenantId, discordId: moderatorDiscordId });
  if (cached) {
    console.log(`[pow] moderator ${moderatorDiscordId} resolved from cache -> Roblox ${cached.robloxUserId}`);
    return cached.robloxUserId;
  }

  if (!moderatorRobloxUsername) {
    console.log(`[pow] moderator ${moderatorDiscordId} has no cached link and gave no username; asking`);
    throw new Error(`I need to verify you as staff before logging this. What's your Roblox username?`);
  }

  const robloxUser = await getRobloxUserIdExact(moderatorRobloxUsername);
  if (!robloxUser) {
    console.warn(`[pow] moderator ${moderatorDiscordId} gave username "${moderatorRobloxUsername}" which did not resolve on Roblox (see [roblox] log line above for why)`);
    throw new Error(`Could not find a Roblox user named "${moderatorRobloxUsername}". If that's definitely your username, try again — it may have been a temporary Roblox API hiccup.`);
  }
  console.log(`[pow] moderator ${moderatorDiscordId} gave username "${moderatorRobloxUsername}" -> Roblox ID ${robloxUser.userId}; checking POW staff directory`);

  const res = await guardedFetch(`${baseUrl(tenantCtx)}/members/lookup?robloxId=${robloxUser.userId}`, {
    headers: { 'Authorization': `Bearer ${token(tenantCtx)}` },
  });
  if (res.status === 404) {
    console.warn(`[pow] Roblox ID ${robloxUser.userId} (${robloxUser.username}) not found in POW staff directory for tenant ${tenantCtx.tenant.tenantId}`);
    throw new Error(`"${robloxUser.username}" isn't listed as staff on this server's POW workspace, so I can't verify you.`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`[pow] /members/lookup failed for Roblox ID ${robloxUser.userId}: HTTP ${res.status} ${text.slice(0, 200)}`);
    throw new Error(`POW staff lookup error ${res.status}: ${text.slice(0, 200)}`);
  }
  const member = await res.json();
  if (!member.discordId) {
    console.warn(`[pow] POW staff record for Roblox ID ${robloxUser.userId} (${robloxUser.username}) has no linked discordId`);
    throw new Error(`"${robloxUser.username}"'s POW staff account isn't linked to a Discord account yet. Link it in the POW dashboard first.`);
  }
  if (String(member.discordId) !== String(moderatorDiscordId)) {
    console.warn(`[pow] POW staff record for Roblox ID ${robloxUser.userId} (${robloxUser.username}) is linked to Discord ${member.discordId}, not the requesting moderator ${moderatorDiscordId}`);
    throw new Error(`"${robloxUser.username}" belongs to a different staff member's POW account, not yours.`);
  }

  await setStaffLink({
    tenantId: tenantCtx.tenant.tenantId,
    discordId: moderatorDiscordId,
    robloxUserId: robloxUser.userId,
    robloxUsername: robloxUser.username,
  });
  console.log(`[pow] verified and cached moderator ${moderatorDiscordId} -> Roblox ${robloxUser.userId} (${robloxUser.username})`);
  return String(robloxUser.userId);
}

export async function logPunishment(tenantCtx, username, moderatorDiscordId, type, reason, moderatorRobloxUsername) {
  const userInfo = await getRobloxUserId(tenantCtx, username);
  if (!userInfo) throw new Error(`Could not find Roblox user: ${username}`);
  // POW's moderatorId field is the moderator's Roblox User ID, not their Discord ID.
  const moderatorId = await resolveModeratorId(tenantCtx, moderatorDiscordId, moderatorRobloxUsername);
  const res = await guardedFetch(`${baseUrl(tenantCtx)}/punishments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token(tenantCtx)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: userInfo.userId,
      moderatorId,
      type,
      reason,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POW error ${res.status}: ${text.slice(0, 200)}`);
  }
  return { player: userInfo.username, type, reason };
}