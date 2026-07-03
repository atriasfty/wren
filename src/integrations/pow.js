import { getRobloxUserId } from './prc.js';
import { assertPublicHttpUrlCached } from '../ai/ssrf.js';

function baseUrl(tenantCtx) {
  return tenantCtx.tenant.powBaseUrl || 'https://pow.ciankelly.xyz';
}

// The base URL is tenant-configurable, so validate it points at a public host
// before sending the tenant's POW token to it (SSRF guard).
async function guardedFetch(urlStr, opts) {
  await assertPublicHttpUrlCached(urlStr);
  return fetch(urlStr, opts);
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
  const serverId = tenantCtx.tenant.powServerId;
  const results = { username: userInfo.username, userId: userInfo.userId, punishments: [] };
  if (serverId) {
    const res = await guardedFetch(`${baseUrl(tenantCtx)}/api/punishments?server=${encodeURIComponent(serverId)}&userId=${userInfo.userId}`, {
      headers: { 'Authorization': `Bearer ${token(tenantCtx)}` },
    });
    if (res.ok) {
      const json = await res.json();
      for (const p of json.punishments || []) {
        results.punishments.push(p);
      }
    }
  }
  return results;
}

export async function logPunishment(tenantCtx, username, moderatorDiscordId, type, reason) {
  const userInfo = await getRobloxUserId(tenantCtx, username);
  if (!userInfo) throw new Error(`Could not find Roblox user: ${username}`);
  const serverId = tenantCtx.tenant.powServerId;
  if (!serverId) throw new Error(`No POW server ID configured`);
  const res = await guardedFetch(`${baseUrl(tenantCtx)}/api/punishments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token(tenantCtx)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      serverId,
      userId: userInfo.userId,
      username: userInfo.username,
      moderatorDiscordId,
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