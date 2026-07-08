import { policyToolKey } from './tools.js';

export const RANK_ORDER = { owner: 4, leadership: 3, admin: 2, mod: 1, user: 0 };

// Tool (policy-key) names that carry a role-policy entry and must have that
// policy enforced by the executor, not just the moderation subset. Mirrors
// the keys of DEFAULT_POLICY in tenant/store.js.
export const POLICY_GATED_TOOLS = new Set([
  'ban_player', 'kick_player', 'kill_player', 'tp_player', 'send_pm',
  'mod_player', 'unmod_player', 'admin_player', 'unadmin_player',
  'purge_messages', 'bring_all_staff', 'pm_all_staff', 'log_punishment',
  'save_memory_server', 'save_memory_user',
  'delete_memory_server', 'delete_memory_user',
  'get_vehicles', 'get_wanted_players', 'get_player_location',
  'get_server_briefing', 'get_player_profile', 'get_server_stats',
  'list_online_players', 'check_if_online', 'check_if_staff', 'get_player_info',
  'get_all_channels', 'get_channel_messages', 'get_user_info',
  'search_command_logs', 'lookup_roblox_profile', 'analyze_player_activity',
  'summarize_chat', 'check_punishments', 'search_web', 'read_webpage',
]);

export function resolveActorRank(actor, tenantCtx) {
  if (!actor) return 'user';
  if (actor.kind === 'discord') {
    const member = actor.member;
    if (!member) return 'user';
    if (member.id === member.guild?.ownerId) return 'owner';
    if (member.permissions?.has?.('ManageGuild')) return 'owner';
    if (member.permissions?.has?.('Administrator')) return 'admin';

    // Configured Leadership/Admin/Mod roles each grant their tier to any
    // member holding a role at or above that role's position in the guild's
    // hierarchy — not just an exact match. This mirrors how Discord's own
    // role ordering implies seniority, and means a member doesn't have to
    // hold the exact configured role, just something ranked at or above it.
    // Checking tiers highest-first with an early return makes this cascade
    // correctly: clearing the (higher) leadership bar returns 'leadership'
    // immediately without needing a separate admin/mod check.
    function hasRoleAtOrAbove(configuredRoleId) {
      if (!configuredRoleId) return false;
      const configuredRole = member.guild?.roles?.cache?.get?.(configuredRoleId);
      if (!configuredRole) return false;
      return !!member.roles?.cache?.some?.(
        (r) => r.id !== member.guild.id && r.position >= configuredRole.position
      );
    }

    if (hasRoleAtOrAbove(tenantCtx.tenant?.leadershipRoleId)) return 'leadership';
    if (hasRoleAtOrAbove(tenantCtx.tenant?.adminRoleId)) return 'admin';
    if (hasRoleAtOrAbove(tenantCtx.tenant?.modRoleId)) return 'mod';

    return 'user';
  }
  if (actor.kind === 'in_game') {
    return actor.isStaff ? 'mod' : 'user';
  }
  if (actor.kind === 'api') {
    return 'user'; // API rank is governed by scopes, not policy table
  }
  if (actor.kind === 'system') {
    // Internal actions (ticket greeter, future internal flows) act on behalf of
    // the server owner. The audit log records `system` as the actor.
    return 'owner';
  }
  return 'user';
}

export function canRunTool(tenantCtx, toolName, args, actor) {
  const key = policyToolKey(toolName, args);
  const required = tenantCtx.policy[key];
  if (!required) return false; // deny by default — explicit policy required
  const actorRank = resolveActorRank(actor, tenantCtx);
  return RANK_ORDER[actorRank] >= RANK_ORDER[required];
}

export function denialReason(tenantCtx, toolName, args, actor) {
  if (canRunTool(tenantCtx, toolName, args, actor)) return null;
  const key = policyToolKey(toolName, args);
  const required = tenantCtx.policy[key] ?? 'unset';
  const actorRank = resolveActorRank(actor, tenantCtx);
  return `Permission denied: tool "${toolName}" requires role "${required}", actor is "${actorRank}".`;
}