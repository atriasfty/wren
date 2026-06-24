const TOOL_DEFS = [
  // moderation
  { name: 'ban_player', description: 'Ban a player from the ERLC server. Use only with explicit authorization and a clear reason.', params: { type: 'object', properties: { username: { type: 'string' }, reason: { type: 'string' }, duration: { type: 'number', description: 'Minutes. 0 = permanent.' } }, required: ['username', 'reason'] } },
  { name: 'kick_player', description: 'Kick a player from the ERLC server.', params: { type: 'object', properties: { username: { type: 'string' }, reason: { type: 'string' } }, required: ['username', 'reason'] } },
  { name: 'kill_player', description: 'Kill a player in-game.', params: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] } },
  { name: 'tp_player', description: 'Teleport one player to another.', params: { type: 'object', properties: { player1: { type: 'string' }, player2: { type: 'string' } }, required: ['player1', 'player2'] } },
  { name: 'send_pm', description: 'Send a private message to a player.', params: { type: 'object', properties: { username: { type: 'string' }, message: { type: 'string' } }, required: ['username', 'message'] } },
  { name: 'mod_player', description: 'Promote to Server Moderator.', params: { type: 'object', properties: { username: { type: 'string' }, reason: { type: 'string' } }, required: ['username'] } },
  { name: 'unmod_player', description: 'Demote a Moderator.', params: { type: 'object', properties: { username: { type: 'string' }, reason: { type: 'string' } }, required: ['username'] } },
  { name: 'admin_player', description: 'Promote to Server Administrator. HIGH RISK: requires explicit owner/admin authorization.', params: { type: 'object', properties: { username: { type: 'string' }, reason: { type: 'string' } }, required: ['username'] } },
  { name: 'unadmin_player', description: 'Demote an Administrator.', params: { type: 'object', properties: { username: { type: 'string' }, reason: { type: 'string' } }, required: ['username'] } },
  { name: 'bring_all_staff', description: 'Teleport all online staff to a destination player.', params: { type: 'object', properties: { destination_player: { type: 'string' } }, required: ['destination_player'] } },
  { name: 'pm_all_staff', description: 'Send a private message to every online staff member.', params: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } },
  { name: 'log_punishment', description: 'Log a punishment to the POW backend. server must be "A".', params: { type: 'object', properties: { username: { type: 'string' }, type: { type: 'string', enum: ['Warn', 'Kick', 'Ban', 'Ban Bolo'] }, reason: { type: 'string' }, server: { type: 'string', enum: ['A'] } }, required: ['username', 'type', 'reason', 'server'] } },
  { name: 'check_punishments', description: 'Look up a player\'s punishment history from POW.', params: { type: 'object', properties: { username: { type: 'string' }, server: { type: 'string', enum: ['A'] } }, required: ['username'] } },
  // Discord
  { name: 'get_all_channels', description: 'List channels accessible to the configured security role.', params: { type: 'object', properties: {} } },
  { name: 'get_channel_messages', description: 'Fetch recent messages from a Discord channel.', params: { type: 'object', properties: { channel_id: { type: 'string' }, limit: { type: 'integer' } }, required: ['channel_id'] } },
  { name: 'get_user_info', description: 'Get a Discord member\'s roles and join date.', params: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] } },
  { name: 'summarize_chat', description: 'Return a recent message transcript from a Discord channel for summarization.', params: { type: 'object', properties: { channel_id: { type: 'string' }, message_count: { type: 'integer' } }, required: ['channel_id'] } },
  { name: 'purge_messages', description: 'Delete a number of recent messages from a Discord channel.', params: { type: 'object', properties: { channel_id: { type: 'string' }, count: { type: 'integer' } }, required: ['channel_id', 'count'] } },
  // ERLC info
  { name: 'get_server_stats', description: 'Get current server stats: players online, max, staff online.', params: { type: 'object', properties: {} } },
  { name: 'list_online_players', description: 'List all players currently online, grouped by rank.', params: { type: 'object', properties: {} } },
  { name: 'check_if_online', description: 'Check if a specific player is online.', params: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] } },
  { name: 'check_if_staff', description: 'Check whether a player is staff (mod/admin/owner).', params: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] } },
  { name: 'get_player_info', description: 'Get a player\'s team, permission level, callsign.', params: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] } },
  { name: 'search_command_logs', description: 'Search recent command-log activity.', params: { type: 'object', properties: { username: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'lookup_roblox_profile', description: 'Public Roblox profile lookup.', params: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] } },
  { name: 'analyze_player_activity', description: 'Summarize a player\'s recent ERLC activity (joins, kills, commands).', params: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] } },
  // memory
  { name: 'save_memory', description: 'Save a fact to long-term memory. type=server for global rules (staff only), type=user for personal facts.', params: { type: 'object', properties: { content: { type: 'string' }, type: { type: 'string', enum: ['server', 'user'] } }, required: ['content', 'type'] } },
];

export function getToolsForMistral() {
  return TOOL_DEFS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.params,
    },
  }));
}

// resolve tool name to the internal policy name. Most map 1:1 except save_memory which
// has two flavours.
export function policyToolKey(name, args) {
  if (name === 'save_memory') return args?.type === 'server' ? 'save_memory_server' : 'save_memory_user';
  return name;
}

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);
