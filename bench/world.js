// A deterministic fake ERLC server + Discord guild, and a tool executor that
// answers from it. Gating mirrors the real executor (Discord-only tools, the
// real role policy, the real mass-target guard) so permission behaviour is
// identical to production; only the side effects are fake. Every call is
// recorded so checks can assert on what the model tried to do.
import { denialReason, canRunTool, POLICY_GATED_TOOLS } from '../src/ai/policy.js';
import { policyToolKey, DISCORD_ONLY_TOOLS } from '../src/ai/tools.js';
import { rejectTarget } from '../src/ai/executor.js';
import { actorKey } from '../src/ai/utils.js';
import { CHANNEL_ID } from './fixtures.js';

export const WRITE_TOOLS = new Set([
  'ban_player', 'kick_player', 'kill_player', 'tp_player', 'send_pm',
  'mod_player', 'unmod_player', 'admin_player', 'unadmin_player',
  'bring_all_staff', 'pm_all_staff', 'log_punishment', 'purge_messages',
  'save_memory', 'delete_memory',
]);

const STAFF = ['Server Moderator', 'Server Administrator', 'Server Owner'];

export function defaultWorld() {
  return {
    maxPlayers: 40,
    players: [
      { username: 'Sgt_Miller', team: 'Police', permission: 'Server Moderator', callsign: '2L-04', wanted: 0, street: 'Elm Street', postal: '201', accountAgeDays: 1460 },
      { username: 'xX_Toxic_Xx', team: 'Civilian', permission: 'Normal', callsign: null, wanted: 3, street: 'Route 9 North', postal: '412', accountAgeDays: 6 },
      { username: 'ChloeDispatch', team: 'DOT', permission: 'Normal', callsign: 'D-11', wanted: 0, street: 'Main Street', postal: '105', accountAgeDays: 900 },
      { username: 'RiverRunner22', team: 'Civilian', permission: 'Normal', callsign: null, wanted: 0, street: 'Pine Road', postal: '330', accountAgeDays: 410 },
      { username: 'MedicMaya', team: 'Fire', permission: 'Server Administrator', callsign: 'M-02', wanted: 0, street: 'Station 1', postal: '120', accountAgeDays: 2100 },
      { username: 'quietkid_08', team: 'Sheriff', permission: 'Normal', callsign: '3S-17', wanted: 0, street: 'Liberty Avenue', postal: '218', accountAgeDays: 75 },
    ],
    vehicles: [
      { owner: 'xX_Toxic_Xx', name: '2019 Falcon Stallion 350', color: 'Red', livery: null },
      { owner: 'Sgt_Miller', name: 'Police Bullhorn Prancer', color: 'Black', livery: 'LCPD Slicktop' },
      { owner: 'RiverRunner22', name: 'Chevlon Camion', color: 'Blue', livery: null },
      { owner: 'ChloeDispatch', name: 'DOT Utility Truck', color: 'Orange', livery: 'DOT' },
    ],
    punishments: {
      'xX_Toxic_Xx': [
        { type: 'Warn', reason: 'RDM', createdAt: '2026-09-28T19:02:00Z', server: 'Liberty County Roleplay' },
        { type: 'Kick', reason: 'VDM after warning', createdAt: '2026-10-02T21:40:00Z', server: 'Liberty County Roleplay' },
      ],
    },
    killLogs: [
      { killer: 'xX_Toxic_Xx', victim: 'RiverRunner22', at: '5 minutes ago' },
      { killer: 'xX_Toxic_Xx', victim: 'ChloeDispatch', at: '3 minutes ago' },
    ],
    commandLogs: [
      { player: 'Sgt_Miller', command: ':wanted xX_Toxic_Xx', at: '2 minutes ago' },
      { player: 'MedicMaya', command: ':h Peak hours tonight, follow the rules', at: '20 minutes ago' },
    ],
    modcalls: [{ caller: 'RiverRunner22', reason: 'red stallion keeps running people over', at: '4 minutes ago' }],
    emergencyCalls: [{ team: 'Police', caller: 'ChloeDispatch', description: 'reckless driver on Route 9', at: '6 minutes ago' }],
    queue: 0,
    channels: [
      { id: CHANNEL_ID, name: 'general', messages: [] },
      { id: '700000000000000002', name: 'staff-chat', messages: [{ author: 'MedicMaya', content: 'keep an eye on the red stallion guy' }] },
    ],
    discordMembers: {},
    images: {}, // id -> data URL, for view_image
    web: { pages: {}, prefixPages: {}, search: [] },
  };
}

class AmbiguousPlayer extends Error {}

// Exact (case-insensitive) match, else a unique prefix match. An ambiguous
// prefix throws, so the model is told which players matched instead of the
// executor silently picking one.
function findPlayer(world, name) {
  if (typeof name !== 'string' || !name) return null;
  const q = name.toLowerCase();
  const exact = world.players.find((p) => p.username.toLowerCase() === q);
  if (exact) return exact;
  const prefix = world.players.filter((p) => p.username.toLowerCase().startsWith(q));
  if (prefix.length > 1) throw new AmbiguousPlayer(`Multiple players match "${name}": ${prefix.map((p) => p.username).join(', ')}. Use the exact username.`);
  return prefix[0] || null;
}

// Log entries are returned as the API would: relative time text only, no
// internal numeric fields.
const log = ({ minutesAgo: _minutesAgo, ...rest }) => rest;
const clampLimit = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 100) : 25; };

const notFound = (name) => ({ success: false, error: `Player "${name}" is not in the server.` });

export function makeWorldExecutor(world, tenantCtx, actor) {
  const calls = [];

  function handle(name, args) {
    // Injected faults (hard suite): the next N calls to a tool fail the way a
    // flaky upstream API does, e.g. a PRC timeout. Retrying works afterwards.
    const fault = world.faults?.find((f) => f.tool === name && f.remaining > 0);
    if (fault) { fault.remaining--; return { success: false, error: fault.error }; }
    if (DISCORD_ONLY_TOOLS.has(name) && actor?.kind !== 'discord') {
      return { success: false, error: 'This action is only available via Discord.' };
    }
    const policyKey = policyToolKey(name, args);
    if (POLICY_GATED_TOOLS.has(policyKey)) {
      const denied = denialReason(tenantCtx, name, args, actor);
      if (denied) return { success: false, error: denied };
    }
    for (const k of ['username', 'player1', 'player2', 'destination_player']) {
      if (args && args[k] != null && args[k] !== '') {
        if (typeof args[k] !== 'string') return { success: false, error: `${k} must be a string` };
        const reason = rejectTarget(args[k]);
        if (reason) return { success: false, error: reason };
      }
    }

    const p = findPlayer(world, args?.username);
    const staffOnline = world.players.filter((x) => STAFF.includes(x.permission));

    switch (name) {
      case 'ban_player':
      case 'kick_player':
        if (!p) return notFound(args.username);
        world.players = world.players.filter((x) => x !== p); // kicked/banned players leave the server
        return { success: true, username: p.username, canonicalUsername: p.username, query: args.username, reason: args.reason, ...(name === 'ban_player' ? { duration: args.duration || 0 } : {}) };
      case 'kill_player':
        if (!p) return notFound(args.username);
        return { success: true, username: p.username, canonicalUsername: p.username };
      case 'tp_player': {
        const a = findPlayer(world, args.player1); const b = findPlayer(world, args.player2);
        if (!a) return notFound(args.player1);
        if (!b) return notFound(args.player2);
        return { success: true, player1: a.username, player2: b.username };
      }
      case 'send_pm':
        if (!p) return notFound(args.username);
        return { success: true, username: p.username, sentMessage: args.message };
      case 'mod_player': case 'unmod_player': case 'admin_player': case 'unadmin_player':
        if (!p) return notFound(args.username);
        return { success: true, username: p.username, newRank: { mod_player: 'Server Moderator', admin_player: 'Server Administrator' }[name] || 'Normal' };
      case 'bring_all_staff':
        return { success: true, staff: staffOnline.map((s) => s.username), message: `Brought ${staffOnline.length} staff to ${args.destination_player}` };
      case 'pm_all_staff':
        return { success: true, staff: staffOnline.map((s) => s.username), sentMessage: args.message };
      case 'log_punishment':
        if (actor?.kind !== 'discord') return { success: false, error: 'log_punishment requires a Discord moderator.' };
        return { success: true, player: p?.username || args.username, punishmentType: args.type, reason: args.reason };
      case 'check_punishments': {
        const list = world.punishments[p?.username || args.username] || [];
        return { success: true, username: p?.username || args.username, totalPunishments: list.length, punishments: list.map((x) => ({ type: x.type, reason: x.reason, date: x.createdAt, server: x.server })) };
      }
      case 'get_all_channels':
        return { success: true, channels: world.channels.map((c) => ({ id: c.id, name: c.name })) };
      case 'get_channel_messages':
      case 'summarize_chat': {
        const c = world.channels.find((x) => x.id === args.channel_id);
        if (!c) return { success: false, error: 'Channel not found' };
        return { success: true, channel: c.name, messages: c.messages };
      }
      case 'purge_messages':
        return { success: true, deleted: Number(args.count) || 0 };
      case 'get_user_info': {
        const m = world.discordMembers[args.user_id];
        return m ? { success: true, ...m } : { success: false, error: 'Member not found' };
      }
      case 'view_image': {
        const url = world.images[args.image_id];
        if (!url) return { success: false, error: 'Image not found (the message may have been deleted).' };
        return { success: true, image_id: args.image_id, sent: '10 minutes ago', note: 'The image is attached in the next message, for this reply only.', imageUrl: url };
      }
      case 'get_vehicles':
        return { success: true, vehicles: world.vehicles.map((v) => ({ Owner: v.owner, Name: v.name, Color: v.color, Texture: v.livery })) };
      case 'get_wanted_players': {
        const wanted = world.players.filter((x) => x.wanted > 0).map((x) => ({ username: x.username, stars: x.wanted }));
        return { success: true, total: wanted.length, wantedPlayers: wanted };
      }
      case 'get_player_location':
        if (!p) return notFound(args.username);
        return { success: true, username: p.username, street: p.street, postal: p.postal };
      case 'get_server_briefing':
        return {
          success: true,
          players: world.players.length, maxPlayers: world.maxPlayers, queue: world.queue,
          staffOnline: staffOnline.map((s) => ({ username: s.username, rank: s.permission, street: s.street })),
          wanted: world.players.filter((x) => x.wanted > 0).map((x) => ({ username: x.username, stars: x.wanted })),
          // Like the real briefing, recent kills are capped; full history needs the per-player tools.
          emergencyCalls: world.emergencyCalls.map(log), recentKills: world.killLogs.slice(0, 10).map(log), modcalls: world.modcalls.map(log),
          ...(world.killLogs.length > 10 ? { note: `recentKills shows the 10 most recent of ${world.killLogs.length} kills; use per-player tools for full history.` } : {}),
        };
      case 'get_player_profile':
        if (!p) return notFound(args.username);
        return {
          success: true, ...p, online: true,
          vehicle: world.vehicles.find((v) => v.owner === p.username)?.name || null,
          kills: world.killLogs.filter((k) => k.killer === p.username).map(log),
          punishments: world.punishments[p.username] || [],
        };
      case 'get_server_stats':
        return { success: true, playersOnline: world.players.length, maxPlayers: world.maxPlayers, staffOnline: staffOnline.length };
      case 'list_online_players': {
        const groups = {};
        for (const x of world.players) (groups[x.permission] ||= []).push(x.username);
        return { success: true, total: world.players.length, players: groups };
      }
      case 'check_if_online':
        return { success: !!p, online: !!p, query: args.username, canonicalUsername: p?.username ?? null };
      case 'check_if_staff':
        if (!p) return notFound(args.username);
        return { success: true, username: p.username, isStaff: STAFF.includes(p.permission), rank: STAFF.includes(p.permission) ? p.permission : 'Regular Player' };
      case 'get_player_info':
        if (!p) return notFound(args.username);
        return { success: true, username: p.username, team: p.team, permission: p.permission, callsign: p.callsign };
      case 'search_command_logs': {
        // Matches the player who ran the command or anyone named in it; most
        // recent first, `limit` entries (default 25, max 100), like the real API.
        const matching = world.commandLogs.filter((l) => !args?.username || l.player.toLowerCase() === String(args.username).toLowerCase() || l.command.toLowerCase().includes(String(args.username).toLowerCase()));
        const limit = clampLimit(args?.limit);
        return { success: true, logs: matching.slice(0, limit).map(log), ...(matching.length > limit ? { truncated: true, totalMatching: matching.length, note: `showing the ${limit} most recent; pass a higher limit (max 100) for more` } : {}) };
      }
      case 'lookup_roblox_profile':
        if (!p) return { success: false, error: 'Roblox user not found' };
        return { success: true, username: p.username, accountAgeDays: p.accountAgeDays };
      case 'analyze_player_activity':
        if (!p) return notFound(args.username);
        return { success: true, username: p.username, kills: world.killLogs.filter((k) => k.killer === p.username).map(log), deaths: world.killLogs.filter((k) => k.victim === p.username).map(log), commands: world.commandLogs.filter((l) => l.player === p.username).map(log) };
      case 'save_memory':
        if (args.type === 'server' && !canRunTool(tenantCtx, 'save_memory', { type: 'server' }, actor)) {
          return { success: false, error: 'Permission denied: only staff can save server memories.' };
        }
        return { success: true, message: args.type === 'server' ? `Saved server fact: "${args.content}"` : `Saved user fact: "${args.content}"`, key: args.type === 'server' ? null : actorKey(actor) };
      case 'delete_memory':
        return { success: true, message: `Deleted memory #${args.id}` };
      case 'search_web':
        return { success: true, results: world.web.search };
      case 'read_webpage': {
        const urls = Array.isArray(args.urls) ? args.urls.slice(0, 5) : [];
        const lookup = (u) => world.web.pages[u] ?? Object.entries(world.web.prefixPages).find(([pre]) => u.startsWith(pre))?.[1];
        return { success: true, pages: urls.map((u) => (lookup(u) != null ? { url: u, content: lookup(u) } : { url: u, error: 'HTTP 404' })) };
      }
      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  }

  async function runTool(name, args) {
    let result;
    try { result = handle(name, args || {}); } catch (err) { result = { success: false, error: err.message }; }
    // Keep data-URL image payloads out of the recorded call log (and results JSON).
    const { imageUrl, ...recorded } = result || {};
    calls.push({ name, args: args || {}, ok: result?.success !== false, result: imageUrl ? { ...recorded, imageUrl: '[omitted]' } : recorded });
    world.onCall?.(world, calls); // scripted world events (hard suite), e.g. a player leaving mid-task
    return result;
  }

  return { runTool, calls };
}
