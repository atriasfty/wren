import { policyToolKey } from './tools.js';

export const RANK_ORDER = { owner: 4, admin: 3, mod: 2, staff: 1, user: 0 };

const STAFF_SLOTS = ['staff_a', 'staff_b', 'staff_c'];

export function resolveActorRank(actor, tenantCtx) {
  if (!actor) return 'user';
  if (actor.kind === 'discord') {
    const member = actor.member;
    if (!member) return 'user';
    if (member.id === member.guild?.ownerId) return 'owner';
    if (member.permissions?.has?.('Administrator')) return 'admin';
    for (const slot of STAFF_SLOTS) {
      const roleId = tenantCtx.roleSlots[slot];
      if (roleId && member.roles?.cache?.has?.(roleId)) return 'mod';
    }
    if (tenantCtx.roleSlots.staff && member.roles?.cache?.has?.(tenantCtx.roleSlots.staff)) return 'staff';
    return 'user';
  }
  if (actor.kind === 'in_game') {
    return actor.isStaff ? 'mod' : 'user';
  }
  if (actor.kind === 'api') {
    return 'user'; // API rank is governed by scopes, not policy table
  }
  if (actor.kind === 'system') {
    // Internal actions (raid auto-ban, ticket greeter) act on behalf of the
    // server owner. The audit log records `system` as the actor.
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