function baseUrl(tenantCtx) {
  return tenantCtx.tenant.prcBaseUrl || process.env.PRC_BASE_URL || 'https://api.erlc.gg/v2';
}

function serverKey(tenantCtx) {
  if (!tenantCtx.tenant.erlcServerKey) {
    throw new Error('Tenant has no ERLC server key configured. Run /wren config view and set it in Secrets.');
  }
  return tenantCtx.tenant.erlcServerKey;
}

async function executeCommand(tenantCtx, command) {
  const res = await fetch(`${baseUrl(tenantCtx)}/server/command`, {
    method: 'POST',
    headers: {
      'Server-Key': serverKey(tenantCtx),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ command }),
  });
  if (!res.ok) {
    if (res.status === 422) throw new Error('Server has no players in it');
    throw new Error(`PRC error ${res.status}`);
  }
  return { success: true };
}

export async function getRobloxUserId(tenantCtx, username) {
  const clean = (username || '').trim();
  if (!clean) return null;
  if (clean.length >= 4) {
    const online = await getOnlinePlayers(tenantCtx);
    const lower = clean.toLowerCase();
    let match = online.find((p) => p.username.toLowerCase() === lower);
    if (!match) match = online.find((p) => p.username.toLowerCase().startsWith(lower));
    if (!match && clean.length >= 5) {
      match = online.find((p) => p.username.toLowerCase().includes(lower));
    }
    if (match) return { userId: match.userId, username: match.username };
  }
  if (clean.length < 3 || clean.length > 20) return null;
  const res = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ usernames: [clean], excludeBannedUsers: false }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.data && data.data.length) return { userId: data.data[0].id, username: data.data[0].name };
  return null;
}

export async function getOnlinePlayers(tenantCtx) {
  try {
    const data = await getServerInfo(tenantCtx);
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
  } catch (err) {
    return [];
  }
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

export async function getServerInfo(tenantCtx) {
  const query = '?Players=true&Staff=true&JoinLogs=true&Queue=true&KillLogs=true&CommandLogs=true&ModCalls=true&EmergencyCalls=true&Vehicles=true';
  const res = await fetch(`${baseUrl(tenantCtx)}/server${query}`, {
    headers: { 'Server-Key': serverKey(tenantCtx) },
  });
  if (!res.ok) throw new Error(`PRC error ${res.status}`);
  return res.json();
}

export async function getServerStaff(tenantCtx) {
  const data = await getServerInfo(tenantCtx);
  return data.Staff || {};
}

export async function getCommandLogs(tenantCtx, { limit } = {}) {
  try {
    const data = await getServerInfo(tenantCtx);
    if (!data.CommandLogs) return [];
    const logs = data.CommandLogs.map((l) => ({
      playerName: l.Player.split(':')[0],
      command: l.Command,
      timestamp: l.Timestamp,
    }));
    return typeof limit === 'number' ? logs.slice(0, limit) : logs;
  } catch (err) {
    return [];
  }
}

export async function getJoinLogs(tenantCtx, { limit } = {}) {
  try {
    const data = await getServerInfo(tenantCtx);
    if (!data.JoinLogs) return [];
    const logs = data.JoinLogs.map((l) => ({
      join: l.Join,
      playerName: l.Player.split(':')[0],
      timestamp: l.Timestamp,
    }));
    return typeof limit === 'number' ? logs.slice(0, limit) : logs;
  } catch (err) {
    return [];
  }
}

export async function getKillLogs(tenantCtx, { limit } = {}) {
  try {
    const data = await getServerInfo(tenantCtx);
    if (!data.KillLogs) return [];
    const logs = data.KillLogs.map((l) => ({
      killerName: l.Killer.split(':')[0],
      killedName: l.Killed.split(':')[0],
      timestamp: l.Timestamp,
    }));
    return typeof limit === 'number' ? logs.slice(0, limit) : logs;
  } catch (err) {
    return [];
  }
}

export async function getModcalls(tenantCtx, { sinceTs, limit } = {}) {
  try {
    const data = await getServerInfo(tenantCtx);
    if (!data.ModCalls) return [];
    let out = data.ModCalls.map((l) => ({
      caller: l.Caller.split(':')[0],
      moderator: l.Moderator ? l.Moderator.split(':')[0] : null,
      timestamp: l.Timestamp,
    }));
    if (typeof sinceTs === 'number') out = out.filter((m) => (m.timestamp || 0) > sinceTs);
    if (typeof limit === 'number') out = out.slice(0, limit);
    return out;
  } catch (err) {
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
