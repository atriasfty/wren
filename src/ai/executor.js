import * as prc from '../integrations/prc.js';
import * as pow from '../integrations/pow.js';
import { webSearch } from '../integrations/brave.js';
import { audit, addMemory } from '../tenant/store.js';
import { canRunTool, denialReason } from './policy.js';
import { actorKey } from './utils.js';

const BANNED_TARGETS = new Set(['all', 'everyone', 'everybody', '*', 'others', 'server', 'people']);
const MOD_TOOLS = new Set([
  'ban_player', 'kick_player', 'kill_player', 'tp_player', 'send_pm',
  'mod_player', 'unmod_player', 'admin_player', 'unadmin_player',
  'purge_messages', 'bring_all_staff', 'pm_all_staff', 'log_punishment',
]);

function rejectTarget(username) {
  if (!username) return null;
  const t = username.toLowerCase().trim();
  if (BANNED_TARGETS.has(t)) return 'Mass actions are not allowed. Specify a single player.';
  if (t === 'garmin' || t === 'wren' || t === 'bot') return 'Cannot target the bot.';
  if (t.length < 2) return 'Target username too short.';
  if (/^\d+$/.test(username)) return 'That looks like a Discord ID, not a Roblox username.';
  return null;
}

function getGuild(tenantCtx, actor) {
  return actor?.guild || null;
}

export async function executeTool(tenantCtx, name, args, actor) {
  if (MOD_TOOLS.has(name)) {
    const denied = denialReason(tenantCtx, name, args, actor);
    if (denied) return { success: false, error: denied };
  }

  // safety: blocked mass-action targets
  for (const k of ['username', 'player1', 'player2', 'destination_player']) {
    if (args && args[k]) {
      const reason = rejectTarget(args[k]);
      if (reason) return { success: false, error: reason };
    }
  }

  try {
    let result;
    switch (name) {
      case 'ban_player': {
        const r = await prc.banPlayer(tenantCtx, args.username, args.reason || 'No reason provided', args.duration || 0);
        result = { success: true, username: r.actualUsername, canonicalUsername: r.actualUsername, query: args.username, reason: args.reason, duration: args.duration || 0 };
        break;
      }
      case 'kick_player': {
        const r = await prc.kickPlayer(tenantCtx, args.username, args.reason || 'No reason provided');
        result = { success: true, username: r.actualUsername, canonicalUsername: r.actualUsername, query: args.username, reason: args.reason };
        break;
      }
      case 'kill_player': {
        const r = await prc.killPlayer(tenantCtx, args.username);
        result = { success: true, username: r.actualUsername, canonicalUsername: r.actualUsername, query: args.username };
        break;
      }
      case 'tp_player': {
        const r = await prc.tpPlayer(tenantCtx, args.player1, args.player2);
        result = { success: true, player1: r.actualUsername1, player2: r.actualUsername2, canonicalUsername1: r.actualUsername1, canonicalUsername2: r.actualUsername2 };
        break;
      }
      case 'send_pm': {
        const r = await prc.sendPrivateMessage(tenantCtx, args.username, args.message);
        result = { success: true, username: r.actualUsername, canonicalUsername: r.actualUsername, query: args.username, sentMessage: args.message };
        break;
      }
      case 'mod_player': {
        const r = await prc.modPlayer(tenantCtx, args.username);
        result = { success: true, username: r.actualUsername, canonicalUsername: r.actualUsername, newRank: 'Server Moderator' };
        break;
      }
      case 'unmod_player': {
        const r = await prc.unmodPlayer(tenantCtx, args.username);
        result = { success: true, username: r.actualUsername, canonicalUsername: r.actualUsername, newRank: 'Normal' };
        break;
      }
      case 'admin_player': {
        const r = await prc.adminPlayer(tenantCtx, args.username);
        result = { success: true, username: r.actualUsername, canonicalUsername: r.actualUsername, newRank: 'Server Administrator' };
        break;
      }
      case 'unadmin_player': {
        const r = await prc.unadminPlayer(tenantCtx, args.username);
        result = { success: true, username: r.actualUsername, canonicalUsername: r.actualUsername, newRank: 'Normal' };
        break;
      }
      case 'bring_all_staff': {
        const players = await prc.getOnlinePlayers(tenantCtx);
        const staff = players.filter((p) => ['Server Moderator', 'Server Administrator', 'Server Owner'].includes(p.permission));
        const done = [];
        for (const s of staff) {
          try { await prc.tpPlayer(tenantCtx, s.username, args.destination_player); done.push(s.username); }
          catch (err) { /* skip */ }
        }
        result = { success: true, staff: done, message: `Brought ${done.length} staff to ${args.destination_player}` };
        break;
      }
      case 'pm_all_staff': {
        const players = await prc.getOnlinePlayers(tenantCtx);
        const staff = players.filter((p) => ['Server Moderator', 'Server Administrator', 'Server Owner'].includes(p.permission));
        const done = [];
        for (const s of staff) {
          try { await prc.sendPrivateMessage(tenantCtx, s.username, args.message); done.push(s.username); }
          catch (err) { /* skip */ }
        }
        result = { success: true, staff: done, sentMessage: args.message };
        break;
      }
      case 'log_punishment': {
        if (actor?.kind !== 'discord') {
          return { success: false, error: 'log_punishment requires a Discord moderator.' };
        }
        const r = await pow.logPunishment(tenantCtx, args.username, actor.member.id, args.type, args.reason, args.server);
        result = { success: true, player: r.player, punishmentType: r.type, reason: r.reason, server: r.server };
        break;
      }
      case 'check_punishments': {
        const r = await pow.getPunishments(tenantCtx, args.username, args.server || null);
        result = {
          success: true,
          username: r.username,
          userId: r.userId,
          totalPunishments: r.punishments.length,
          punishments: r.punishments.map((p) => ({
            type: p.type,
            reason: p.reason,
            date: p.createdAt,
            server: p.server,
          })),
        };
        break;
      }
      case 'get_server_stats': {
        const [players, info, staff] = await Promise.all([
          prc.getOnlinePlayers(tenantCtx),
          prc.getServerInfo(tenantCtx),
          prc.getServerStaff(tenantCtx),
        ]);
        const staffOnline = players.filter((p) => ['Server Moderator', 'Server Administrator', 'Server Owner'].includes(p.permission)).length;
        const totalAdmins = Object.keys(staff.Admins || {}).length;
        const totalMods = Object.keys(staff.Mods || {}).length;
        result = {
          success: true,
          currentPlayers: players.length,
          maxPlayers: info.MaxPlayers,
          staffOnline,
          totalAdmins,
          totalMods,
          serverName: info.Name || 'ERLC Server',
        };
        break;
      }
      case 'list_online_players': {
        const players = await prc.getOnlinePlayers(tenantCtx);
        const groups = { owners: [], admins: [], mods: [], regulars: [] };
        for (const p of players) {
          const entry = { canonical: p.username, query: p.username };
          if (p.permission === 'Server Owner') groups.owners.push(entry);
          else if (p.permission === 'Server Administrator') groups.admins.push(entry);
          else if (p.permission === 'Server Moderator') groups.mods.push(entry);
          else groups.regulars.push(entry);
        }
        result = { success: true, total: players.length, players: groups };
        break;
      }
      case 'check_if_online': {
        const p = await prc.findPlayer(tenantCtx, args.username);
        result = { success: !!p, online: !!p, query: args.username, canonicalUsername: p?.username ?? null };
        break;
      }
      case 'check_if_staff': {
        const players = await prc.getOnlinePlayers(tenantCtx);
        const term = args.username.toLowerCase();
        const p = players.find((x) => x.username.toLowerCase() === term || x.username.toLowerCase().includes(term));
        if (!p) return { success: false, error: `Player ${args.username} is not online` };
        const isStaff = ['Server Moderator', 'Server Administrator', 'Server Owner'].includes(p.permission);
        result = { success: true, username: p.username, isStaff, rank: isStaff ? p.permission : 'Regular Player' };
        break;
      }
      case 'get_player_info': {
        const players = await prc.getOnlinePlayers(tenantCtx);
        const term = args.username.toLowerCase();
        const p = players.find((x) => x.username.toLowerCase() === term || x.username.toLowerCase().includes(term));
        if (!p) return { success: false, error: `Player ${args.username} is not online` };
        result = { success: true, username: p.username, team: p.team, permission: p.permission, callsign: p.callsign || 'None' };
        break;
      }
      case 'search_command_logs': {
        const logs = await prc.getCommandLogs(tenantCtx);
        const term = args.username?.toLowerCase();
        const filtered = term ? logs.filter((l) => l.playerName.toLowerCase().includes(term)) : logs;
        const sorted = filtered.sort((a, b) => b.timestamp - a.timestamp).slice(0, args.limit || 10);
        result = {
          success: true,
          logs: sorted.map((l) => ({ player: l.playerName, command: l.command, timestamp: new Date(l.timestamp * 1000).toISOString() })),
          total: sorted.length,
        };
        break;
      }
      case 'lookup_roblox_profile': {
        const u = await prc.getRobloxUserId(tenantCtx, args.username);
        if (!u) return { success: false, error: 'User not found' };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8_000);
        let res;
        try {
          res = await fetch(`https://users.roblox.com/v1/users/${u.userId}`, { signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) return { success: false, error: 'Roblox lookup failed' };
        const data = await res.json();
        result = {
          success: true,
          username: data.name,
          displayName: data.displayName,
          id: data.id,
          created: data.created,
          description: data.description,
          isBanned: data.isBanned,
          hasVerifiedBadge: data.hasVerifiedBadge,
        };
        break;
      }
      case 'analyze_player_activity': {
        const [cmdLogs, joinLogs, killLogs] = await Promise.all([
          prc.getCommandLogs(tenantCtx),
          prc.getJoinLogs(tenantCtx),
          prc.getKillLogs(tenantCtx),
        ]);
        const term = args.username.toLowerCase();
        const cmds = cmdLogs.filter((l) => l.playerName.toLowerCase().includes(term));
        const joins = joinLogs.filter((l) => l.playerName.toLowerCase().includes(term));
        const kills = killLogs.filter((l) => l.killerName.toLowerCase().includes(term));
        const deaths = killLogs.filter((l) => l.killedName.toLowerCase().includes(term));
        result = {
          success: true,
          username: args.username,
          summary: {
            commandsUsed: cmds.length,
            joins: joins.filter((j) => j.join).length,
            leaves: joins.filter((j) => !j.join).length,
            kills: kills.length,
            deaths: deaths.length,
          },
          recentCommands: cmds.slice(0, 5).map((c) => `${c.command} (${c.timestamp})`),
          recentKills: kills.slice(0, 3).map((k) => `Killed ${k.killedName} (${k.timestamp})`),
        };
        break;
      }
      case 'get_all_channels': {
        const guild = getGuild(tenantCtx, actor);
        if (!guild) return { success: false, error: 'Discord guild context required' };
        const secRoleId = tenantCtx.tenant.securityRoleId;
        if (!secRoleId) return { success: false, error: 'No security_role_id configured for this tenant.' };
        const secRole = guild.roles.cache.get(secRoleId);
        if (!secRole) return { success: false, error: 'Security role not found.' };
        const channels = guild.channels.cache
          .filter((c) => c.permissionsFor(secRole)?.has?.('ViewChannel'))
          .map((c) => ({ name: c.name, id: c.id, type: c.type === 0 ? 'Text' : c.type === 2 ? 'Voice' : c.type === 4 ? 'Category' : 'Other', parentId: c.parentId }));
        result = { success: true, total: channels.length, channels };
        break;
      }
      case 'get_channel_messages': {
        const guild = getGuild(tenantCtx, actor);
        if (!guild) return { success: false, error: 'Discord guild context required' };
        const channel = await guild.channels.fetch(args.channel_id).catch(() => null);
        if (!channel) return { success: false, error: 'Channel not found' };
        if (!channel.isTextBased()) return { success: false, error: 'Channel not text-based' };
        const limit = Math.min(args.limit || 50, 100);
        const msgs = await channel.messages.fetch({ limit });
        result = {
          success: true,
          channel: channel.name,
          count: msgs.size,
          messages: msgs.map((m) => ({ author: m.author.username, content: m.content, timestamp: m.createdAt.toISOString(), id: m.id })).reverse(),
        };
        break;
      }
      case 'get_user_info': {
        const guild = getGuild(tenantCtx, actor);
        if (!guild) return { success: false, error: 'Discord guild context required' };
        let member;
        if (/^\d+$/.test(args.user_id)) {
          member = await guild.members.fetch(args.user_id).catch(() => null);
        }
        if (!member) {
          const fetched = await guild.members.fetch({ query: String(args.user_id).toLowerCase(), limit: 1 }).catch(() => null);
          member = fetched?.first();
        }
        if (!member) return { success: false, error: `User '${args.user_id}' not found` };
        const roles = member.roles.cache.filter((r) => r.name !== '@everyone').map((r) => r.name).join(', ');
        result = { success: true, username: member.user.username, nickname: member.nickname, id: member.id, joinedAt: member.joinedAt, roles, isBot: member.user.bot };
        break;
      }
      case 'summarize_chat': {
        const guild = getGuild(tenantCtx, actor);
        if (!guild) return { success: false, error: 'Discord guild context required' };
        const channel = await guild.channels.fetch(args.channel_id).catch(() => null);
        if (!channel || !channel.isTextBased()) return { success: false, error: 'Channel not found or not text-based' };
        const limit = Math.min(args.message_count || 50, 100);
        const msgs = await channel.messages.fetch({ limit });
        const chatLog = msgs.map((m) => {
          const time = m.createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          return `[${time}] ${m.author.username}: ${m.content}`;
        }).reverse().join('\n');
        result = { success: true, channel: channel.name, messageCount: msgs.size, chatLog };
        break;
      }
      case 'purge_messages': {
        const guild = getGuild(tenantCtx, actor);
        if (!guild) return { success: false, error: 'Discord guild context required' };
        const channel = await guild.channels.fetch(args.channel_id).catch(() => null);
        if (!channel || !channel.isTextBased()) return { success: false, error: 'Channel not found' };
        const count = Math.min(args.count || 10, 100);
        const deleted = await channel.bulkDelete(count, true);
        result = { success: true, message: `Deleted ${deleted.size} messages`, count: deleted.size };
        break;
      }
      case 'save_memory': {
        if (args.type === 'server') {
          if (!canRunTool(tenantCtx, 'save_memory', { type: 'server' }, actor)) {
            return { success: false, error: 'Permission denied: only staff can save server memories.' };
          }
          await addMemory({ tenantId: tenantCtx.tenantId, scope: 'server', content: args.content, addedBy: actorKey(actor) });
        } else {
          const key = actorKey(actor);
          await addMemory({ tenantId: tenantCtx.tenantId, scope: 'user', userKey: key, content: args.content, addedBy: key });
        }
        result = { success: true, message: args.type === 'server' ? `Saved server fact: "${args.content}"` : `Saved user fact: "${args.content}"` };
        break;
      }
      case 'search_web': {
        const results = await webSearch(args.query, { count: 4 });
        result = { success: true, results };
        break;
      }
      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }

    if (MOD_TOOLS.has(name)) {
      await audit({
        tenantId: tenantCtx.tenantId,
        actor: actorKey(actor),
        action: name,
        target: JSON.stringify(args),
        metadata: { ok: result.success },
      });
    }
    return result;
  } catch (err) {
    if (MOD_TOOLS.has(name)) {
      await audit({
        tenantId: tenantCtx.tenantId,
        actor: actorKey(actor),
        action: name,
        target: JSON.stringify(args),
        metadata: { ok: false, error: err.message },
      });
    }
    return { success: false, error: err.message };
  }
}
