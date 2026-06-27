import { policyToolKey } from './tools.js';

export const RANK_ORDER = { owner: 4, leadership: 3, admin: 2, mod: 1, user: 0 };

export function resolveActorRank(actor, tenantCtx) {
  if (!actor) return 'user';
  if (actor.kind === 'discord') {
    if (actor.isTicket) return 'user'; // Force user rank for autoresponder
    const member = actor.member;
    if (!member) return 'user';
    if (member.id === member.guild?.ownerId) return 'owner';
    if (member.permissions?.has?.('ManageGuild')) return 'owner';
    if (member.permissions?.has?.('Administrator')) return 'admin';
    // Dedicated leadership role on tenant config
    const leadershipRoleId = tenantCtx.tenant?.leadershipRoleId;
    if (leadershipRoleId && member.roles?.cache?.has?.(leadershipRoleId)) return 'leadership';
    
    // Dedicated admin role on tenant config (matches the role and every role above it)
    const adminRoleId = tenantCtx.tenant?.adminRoleId;
    if (adminRoleId) {
      const adminRole = member.guild?.roles?.cache?.get?.(adminRoleId);
      if (adminRole && member.roles?.cache?.some?.(r => r.position >= adminRole.position && r.id !== member.guild.id)) return 'admin';
    }

    // Dedicated mod role on tenant config
    const modRoleId = tenantCtx.tenant?.modRoleId;
    if (modRoleId && member.roles?.cache?.has?.(modRoleId)) return 'mod';
    
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