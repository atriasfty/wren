import { getRobloxUserId } from './prc.js';

function baseUrl(tenantCtx) {
  return tenantCtx.tenant.powBaseUrl;
}

function token(tenantCtx) {
  if (!tenantCtx.tenant.powToken) {
    throw new Error('Tenant has no POW token configured. Run /wren config pow token:<token>');
  }
  return tenantCtx.tenant.powToken;
}

function serverLabel(tenantCtx, key) {
  const t = tenantCtx.tenant;
  return key === 'A' ? t.powServerAId : key === 'B' ? t.powServerBId : null;
}

export async function getPunishments(tenantCtx, username, server = null) {
  const userInfo = await getRobloxUserId(tenantCtx, username);
  if (!userInfo) throw new Error(`Could not find Roblox user: ${username}`);
  const serversToQuery = server
    ? [{ key: server.toUpperCase(), id: serverLabel(tenantCtx, server.toUpperCase()) }]
    : [
        { key: 'A', id: tenantCtx.tenant.powServerAId },
        { key: 'B', id: tenantCtx.tenant.powServerBId },
      ];
  const results = { username: userInfo.username, userId: userInfo.userId, punishments: [] };
  for (const srv of serversToQuery) {
    if (!srv.id) continue;
    const res = await fetch(`${baseUrl(tenantCtx)}/api/punishments?server=${encodeURIComponent(srv.id)}&userId=${userInfo.userId}`, {
      headers: { 'Authorization': `Bearer ${token(tenantCtx)}` },
    });
    if (!res.ok) continue;
    const json = await res.json();
    for (const p of json.punishments || []) {
      results.punishments.push({ ...p, server: srv.key });
    }
  }
  return results;
}

export async function logPunishment(tenantCtx, username, moderatorDiscordId, type, reason, server) {
  const userInfo = await getRobloxUserId(tenantCtx, username);
  if (!userInfo) throw new Error(`Could not find Roblox user: ${username}`);
  const serverId = serverLabel(tenantCtx, server);
  if (!serverId) throw new Error(`Unknown server label: ${server}`);
  const res = await fetch(`${baseUrl(tenantCtx)}/api/punishments`, {
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
  return { player: userInfo.username, type, reason, server };
}