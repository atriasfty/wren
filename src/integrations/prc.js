import { assertPublicHttpUrlCached, ssrfAgent } from '../ai/ssrf.js';

function baseUrl(tenantCtx) {
  return tenantCtx.tenant.prcBaseUrl || process.env.PRC_BASE_URL || 'https://api.erlc.gg/v1';
}

// The base URL is tenant-configurable, so validate it points at a public host
// before sending the tenant's server key to it (SSRF guard).
async function guardedFetch(urlStr, opts) {
  await assertPublicHttpUrlCached(urlStr);
  // Pin the socket to a connect-time-validated address (DNS-rebind defence).
  return fetch(urlStr, { ...opts, dispatcher: ssrfAgent });
}

function serverKey(tenantCtx) {
  if (!tenantCtx.tenant.erlcServerKey) {
    throw new Error('CRITICAL API KEY ERROR: Tenant has no ERLC server key configured. You must flag this to higher-ups/server owner immediately so they can set it in /wren config under Secrets.');
  }
  return tenantCtx.tenant.erlcServerKey;
}

async function executeCommand(tenantCtx, command) {
  const res = await guardedFetch(`${baseUrl(tenantCtx)}/server/command`, {
    method: 'POST',
    headers: {
      'Server-Key': serverKey(tenantCtx),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ command }),
  });
  if (!res.ok) {
    if (res.status === 422) throw new Error('Server has no players in it');
    let errmsg = `PRC API error ${res.status}: ${res.statusText}`;
    try {
      const data = await res.json();
      if (data.message) errmsg = `PRC API error ${res.status}: ${data.message}`;
    } catch (e) { /* ignore */ }
    throw new Error(errmsg);
  }
  return { success: true };
}

const ROBLOX_USER_CACHE = new Map();
const CACHE_TTL = 3600 * 1000; // 1 hour

// Expired entries are only replaced on re-lookup, never evicted, so the map
// grows with every unique (tenant, name) ever queried. Wipe it fully every
// 30 days. setInterval's delay caps at ~24.8 days (2^31-1 ms), so a daily
// sweep checks elapsed time instead of one long timer.
const CACHE_CLEAR_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
let cacheLastClearedAt = Date.now();
setInterval(() => {
  if (Date.now() - cacheLastClearedAt >= CACHE_CLEAR_INTERVAL_MS) {
    cacheLastClearedAt = Date.now();
    ROBLOX_USER_CACHE.clear();
    console.log('[roblox] cleared username cache (30-day sweep)');
  }
}, 24 * 60 * 60 * 1000).unref?.();

// Direct global Roblox username -> userId lookup, no in-game fuzzy matching.
// A non-2xx response (rate limit, transient outage) is logged and distinguished
// from "no such user" — callers get null either way, but the failure is visible
// in server logs instead of silently reading as an invalid username.
async function lookupRobloxUsernameExact(clean) {
  let res;
  try {
    res = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ usernames: [clean], excludeBannedUsers: false }),
    });
  } catch (err) {
    console.warn(`[roblox] username lookup network error for "${clean}": ${err.message}`);
    return null;
  }
  if (!res.ok) {
    console.warn(`[roblox] username lookup failed for "${clean}": HTTP ${res.status}`);
    return null;
  }
  const data = await res.json();
  if (data.data && data.data.length) {
    return { userId: data.data[0].id, username: data.data[0].name };
  }
  return null;
}

// Resolves a Roblox username with no in-game context — for verifying a person's
// own account (e.g. a moderator), not for finding a target player in-server.
export async function getRobloxUserIdExact(username) {
  const clean = (username || '').trim();
  if (clean.length < 3 || clean.length > 20) return null;
  return lookupRobloxUsernameExact(clean);
}

export async function getRobloxUserId(tenantCtx, username) {
  const clean = (username || '').trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();

  // Fuzzy matches against the tenant's online players are cached per tenant —
  // a partial name resolved on one server must never leak into another.
  const fuzzyKey = `${tenantCtx?.tenantId ?? '?'}:${lower}`;
  const cached = ROBLOX_USER_CACHE.get(fuzzyKey) || ROBLOX_USER_CACHE.get(lower);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  if (clean.length >= 4) {
    // The fuzzy in-game match is best-effort: if the PRC lookup fails (broken
    // key, API outage), fall through to the global Roblox lookup below rather
    // than failing — offline-profile lookups must keep working for tenants
    // without a working ERLC key.
    let online = [];
    try {
      online = await getOnlinePlayers(tenantCtx);
    } catch (err) {
      console.warn(`[roblox] online-player lookup failed for tenant ${tenantCtx?.tenantId ?? '?'} (falling back to global lookup): ${err.message}`);
    }
    let match = online.find((p) => p.username.toLowerCase() === lower);
    if (!match) match = online.find((p) => p.username.toLowerCase().startsWith(lower));
    if (!match && clean.length >= 5) {
      match = online.find((p) => p.username.toLowerCase().includes(lower));
    }
    if (match) {
      const data = { userId: match.userId, username: match.username };
      ROBLOX_USER_CACHE.set(fuzzyKey, { data, expires: Date.now() + CACHE_TTL });
      return data;
    }
  }
  if (clean.length < 3 || clean.length > 20) return null;
  const result = await lookupRobloxUsernameExact(clean);
  if (result) ROBLOX_USER_CACHE.set(lower, { data: result, expires: Date.now() + CACHE_TTL });
  return result;
}

// Throws on API/key errors instead of returning [] — an empty list means "the
// server is genuinely empty". Swallowing errors here made a missing/broken
// ERLC key read as "0 players online" ("Player X is not online", empty
// briefings) instead of surfacing the real configuration problem to the user.
export async function getOnlinePlayers(tenantCtx) {
  const data = await getServerInfo(tenantCtx, ['Players']);
  if (!data.Players) return [];
  return data.Players.map((player) => {
    const [username, idStr] = player.Player.split(':');
    return {
      username,
      userId: parseInt(idStr, 10),
      permission: player.Permission,
      team: player.Team,
      callsign: player.Callsign,
      location: player.Location,
      wantedStars: player.WantedStars,
    };
  });
}

export async function findPlayer(tenantCtx, partialName) {
  const players = await getOnlinePlayers(tenantCtx);
  if (!players.length) return null;
  const term = partialName.toLowerCase().trim();
  return (
    players.find((p) => p.username.toLowerCase() === term) ||
    players.find((p) => p.username.toLowerCase().startsWith(term)) ||
    players.find((p) => p.username.toLowerCase().includes(term)) ||
    null
  );
}

export async function getServerInfo(tenantCtx, fields = null) {
  const query = (fields && Array.isArray(fields) && fields.length > 0)
    ? '?' + fields.map(f => `${f}=true`).join('&')
    : '?Players=true&Staff=true&JoinLogs=true&Queue=true&KillLogs=true&CommandLogs=true&ModCalls=true&EmergencyCalls=true&Vehicles=true';
  const res = await guardedFetch(`${baseUrl(tenantCtx)}/server${query}`, {
    headers: { 'Server-Key': serverKey(tenantCtx) },
  });
  if (!res.ok) {
    let errmsg = `PRC API error ${res.status}: ${res.statusText}`;
    try {
      const data = await res.json();
      if (data.message) errmsg = `PRC API error ${res.status}: ${data.message}`;
    } catch (e) { /* ignore */ }
    throw new Error(errmsg);
  }
  return res.json();
}

export async function getServerStaff(tenantCtx) {
  const data = await getServerInfo(tenantCtx, ['Staff']);
  return data.Staff || {};
}

// Like getOnlinePlayers, the log getters throw on API/key errors so tools
// report the real problem instead of pretending the logs are empty. Callers
// that want per-section best-effort behavior (get_player_profile) wrap each
// call themselves.
export async function getCommandLogs(tenantCtx, { limit } = {}) {
  const data = await getServerInfo(tenantCtx, ['CommandLogs']);
  if (!data.CommandLogs) return [];
  const logs = data.CommandLogs.map((l) => ({
    playerName: l.Player.split(':')[0],
    command: l.Command,
    timestamp: l.Timestamp,
  }));
  return typeof limit === 'number' ? logs.slice(0, limit) : logs;
}

export async function getJoinLogs(tenantCtx, { limit } = {}) {
  const data = await getServerInfo(tenantCtx, ['JoinLogs']);
  if (!data.JoinLogs) return [];
  const logs = data.JoinLogs.map((l) => ({
    join: l.Join,
    playerName: l.Player.split(':')[0],
    timestamp: l.Timestamp,
  }));
  return typeof limit === 'number' ? logs.slice(0, limit) : logs;
}

export async function getKillLogs(tenantCtx, { limit } = {}) {
  const data = await getServerInfo(tenantCtx, ['KillLogs']);
  if (!data.KillLogs) return [];
  const logs = data.KillLogs.map((l) => ({
    killerName: l.Killer.split(':')[0],
    killedName: l.Killed.split(':')[0],
    timestamp: l.Timestamp,
  }));
  return typeof limit === 'number' ? logs.slice(0, limit) : logs;
}

// getModcalls is hit every 30s per tenant by the in-game bridge (which skips
// tenants without an ERLC key), so transient failures are warned at most once
// per tenant per 10 minutes to keep logs readable.
const MODCALL_WARN_INTERVAL_MS = 10 * 60 * 1000;
const modcallLastWarnAt = new Map();

// The in-game bridge listens for `:pm <bot> <question>` messages. The ModCalls
// endpoint carries no message text, so the actual PM text comes from the
// command logs (each entry's Command field holds the full command line).
// Returns entries shaped { callerName, message, timestamp }.
export async function getModcalls(tenantCtx, { sinceTs, limit } = {}) {
  try {
    const data = await getServerInfo(tenantCtx, ['CommandLogs']);
    if (!data.CommandLogs) return [];
    let out = data.CommandLogs
      .filter((l) => /^:\s*pm\s+/i.test(l.Command || ''))
      .map((l) => ({
        callerName: l.Player.split(':')[0],
        message: l.Command,
        timestamp: l.Timestamp,
      }));
    if (typeof sinceTs === 'number' && sinceTs > 0) {
      out = out.filter((m) => (m.timestamp || 0) > sinceTs);
    } else {
      // First poll after boot: only look at the last two minutes so we don't
      // replay the whole historical log as fresh PMs.
      const cutoff = Math.floor(Date.now() / 1000) - 120;
      out = out.filter((m) => (m.timestamp || 0) > cutoff);
    }
    if (typeof limit === 'number') out = out.slice(0, limit);
    return out;
  } catch (err) {
    // The 15s poll loop must keep running across transient failures, but a
    // permanently broken key would otherwise kill the in-game bridge with no
    // trace — log it so the failure is at least visible in server logs.
    const tenantId = tenantCtx?.tenantId ?? '?';
    const lastWarn = modcallLastWarnAt.get(tenantId) || 0;
    if (Date.now() - lastWarn > MODCALL_WARN_INTERVAL_MS) {
      modcallLastWarnAt.set(tenantId, Date.now());
      console.warn(`[prc] getModcalls failed for tenant ${tenantId}: ${err.message}`);
    }
    return [];
  }
}

export async function banPlayer(tenantCtx, username, reason = 'No reason provided', duration = 0) {
  const userInfo = await getRobloxUserId(tenantCtx, username);
  if (!userInfo) throw new Error(`Could not find Roblox user: ${username}`);
  const cmd = duration === 0
    ? `:ban ${userInfo.userId} ${reason}`
    : `:ban ${userInfo.userId} ${duration} ${reason}`;
  const result = await executeCommand(tenantCtx, cmd);
  return { ...result, actualUsername: userInfo.username };
}

export async function kickPlayer(tenantCtx, username, reason = 'No reason provided') {
  const userInfo = await getRobloxUserId(tenantCtx, username);
  if (!userInfo) throw new Error(`Could not find Roblox user: ${username}`);
  return { ...(await executeCommand(tenantCtx, `:kick ${userInfo.username} ${reason}`)), actualUsername: userInfo.username };
}

export async function killPlayer(tenantCtx, username) {
  if (!username) throw new Error('killPlayer: username required');
  const userInfo = await getRobloxUserId(tenantCtx, username);
  if (!userInfo) throw new Error(`Could not find Roblox user: ${username}`);
  return { ...(await executeCommand(tenantCtx, `:kill ${userInfo.username}`)), actualUsername: userInfo.username };
}

export async function tpPlayer(tenantCtx, player1, player2) {
  const a = await getRobloxUserId(tenantCtx, player1);
  if (!a) throw new Error(`Could not find Roblox user: ${player1}`);
  const b = await getRobloxUserId(tenantCtx, player2);
  if (!b) throw new Error(`Could not find Roblox user: ${player2}`);
  const r = await executeCommand(tenantCtx, `:tp ${a.username} ${b.username}`);
  return { ...r, actualUsername1: a.username, actualUsername2: b.username };
}

export async function sendPrivateMessage(tenantCtx, username, message) {
  if (!username) throw new Error('sendPrivateMessage: username required');
  if (!message) throw new Error('sendPrivateMessage: message required');
  const userInfo = await getRobloxUserId(tenantCtx, username);
  if (!userInfo) throw new Error(`Could not find Roblox user: ${username}`);
  return { ...(await executeCommand(tenantCtx, `:pm ${userInfo.username} ${message}`)), actualUsername: userInfo.username };
}

export async function modPlayer(tenantCtx, username) {
  const u = await getRobloxUserId(tenantCtx, username);
  if (!u) throw new Error(`Could not find Roblox user: ${username}`);
  return { ...(await executeCommand(tenantCtx, `:mod ${u.userId}`)), actualUsername: u.username };
}

export async function unmodPlayer(tenantCtx, username) {
  const u = await getRobloxUserId(tenantCtx, username);
  if (!u) throw new Error(`Could not find Roblox user: ${username}`);
  return { ...(await executeCommand(tenantCtx, `:unmod ${u.userId}`)), actualUsername: u.username };
}

export async function adminPlayer(tenantCtx, username) {
  const u = await getRobloxUserId(tenantCtx, username);
  if (!u) throw new Error(`Could not find Roblox user: ${username}`);
  return { ...(await executeCommand(tenantCtx, `:admin ${u.userId}`)), actualUsername: u.username };
}

export async function unadminPlayer(tenantCtx, username) {
  const u = await getRobloxUserId(tenantCtx, username);
  if (!u) throw new Error(`Could not find Roblox user: ${username}`);
  return { ...(await executeCommand(tenantCtx, `:unadmin ${u.userId}`)), actualUsername: u.username };
}
