import { describe, it, expect } from 'vitest';
import { canRunTool, resolveActorRank, denialReason } from '../ai/policy.js';

function tenantCtxWith(policy, roleSlots = {}, tenant = {}) {
  return { policy, roleSlots, tenantId: 'test', tenant };
}

// rolePositions maps every role id that matters for a test (both roles the
// member holds and tenant-configured role ids) to its hierarchy position, so
// hasRoleAtOrAbove can be exercised the same way it runs against a real
// discord.js guild.
function discordActor({ id = '1', owner = false, admin = false, roleIds = [], rolePositions = {} } = {}) {
  const guild = {
    ownerId: owner ? id : '999',
    roles: {
      cache: {
        get: (rid) => (rid in rolePositions ? { id: rid, position: rolePositions[rid] } : undefined),
      },
    },
  };
  const perms = { has: (p) => (p === 'Administrator' ? admin : false) };
  const member = {
    id,
    guild,
    permissions: perms,
    roles: {
      cache: {
        has: (rid) => roleIds.includes(rid),
        some: (fn) => roleIds.some((rid) => fn({ id: rid, position: rolePositions[rid] ?? 0 })),
      },
    },
  };
  return { kind: 'discord', member };
}

describe('policy.canRunTool', () => {
  it('denies when no policy row exists (default deny)', () => {
    const ctx = tenantCtxWith({});
    expect(canRunTool(ctx, 'ban_player', {}, discordActor({ owner: true }))).toBe(false);
  });

  it('mod can run ban_player when policy is mod', () => {
    const ctx = tenantCtxWith({ ban_player: 'mod' });
    expect(canRunTool(ctx, 'ban_player', {}, discordActor({ roleIds: ['mod-role'] }))).toBe(false);
    expect(canRunTool(ctx, 'ban_player', {}, discordActor({ admin: true }))).toBe(true);
  });

  it('admin_player requires admin', () => {
    const ctx = tenantCtxWith({ admin_player: 'admin' });
    expect(canRunTool(ctx, 'admin_player', {}, discordActor({ owner: true }))).toBe(true);
    expect(canRunTool(ctx, 'admin_player', {}, discordActor({ admin: true }))).toBe(true);
    expect(canRunTool(ctx, 'admin_player', {}, discordActor({ roleIds: ['s'] }))).toBe(false);
  });

  it('save_memory with type=server resolves to save_memory_server policy', () => {
    const ctx = tenantCtxWith({ save_memory_server: 'admin', save_memory_user: 'user' });
    expect(canRunTool(ctx, 'save_memory', { type: 'server' }, discordActor({ admin: true }))).toBe(true);
    expect(canRunTool(ctx, 'save_memory', { type: 'server' }, discordActor({}))).toBe(false);
    expect(canRunTool(ctx, 'save_memory', { type: 'user' }, discordActor({}))).toBe(true);
  });

  it('in_game staff rank is mod; non-staff is user', () => {
    expect(resolveActorRank({ kind: 'in_game', playerName: 'x', isStaff: true }, { roleSlots: {} })).toBe('mod');
    expect(resolveActorRank({ kind: 'in_game', playerName: 'x', isStaff: false }, { roleSlots: {} })).toBe('user');
  });

  it('api actor is "user" (scopes govern, not policy rank)', () => {
    expect(resolveActorRank({ kind: 'api', tokenId: 'a' }, { roleSlots: {} })).toBe('user');
  });

  it('system actor resolves to owner (ticket greeter, future internal actions)', () => {
    expect(resolveActorRank({ kind: 'system' }, { roleSlots: {} })).toBe('owner');
    const ctx = tenantCtxWith({ ban_player: 'admin' });
    expect(canRunTool(ctx, 'ban_player', {}, { kind: 'system' })).toBe(true);
  });

  it('denial reason string mentions both roles', () => {
    const ctx = tenantCtxWith({ purge_messages: 'mod' });
    const reason = denialReason(ctx, 'purge_messages', {}, discordActor({}));
    expect(reason).toMatch(/purge_messages/);
    expect(reason).toMatch(/mod/);
    expect(reason).toMatch(/user/);
  });
});

describe('resolveActorRank: configured role hierarchy (leadership/admin/mod all position-based)', () => {
  const tenant = { leadershipRoleId: 'lead-role', adminRoleId: 'admin-role', modRoleId: 'mod-role' };
  // Higher position = more senior, matching discord.js semantics.
  const rolePositions = { 'lead-role': 30, 'admin-role': 20, 'mod-role': 10, 'other-role': 5 };

  it('grants leadership via an exact match on the configured role', () => {
    const ctx = tenantCtxWith({}, {}, tenant);
    const actor = discordActor({ roleIds: ['lead-role'], rolePositions });
    expect(resolveActorRank(actor, ctx)).toBe('leadership');
  });

  it('grants leadership to a role positioned above the configured leadership role, not just an exact match', () => {
    const ctx = tenantCtxWith({}, {}, tenant);
    const actor = discordActor({ roleIds: ['above-lead'], rolePositions: { ...rolePositions, 'above-lead': 40 } });
    expect(resolveActorRank(actor, ctx)).toBe('leadership');
  });

  it('grants admin to a role at or above the configured admin role but below leadership', () => {
    const ctx = tenantCtxWith({}, {}, tenant);
    const exact = discordActor({ roleIds: ['admin-role'], rolePositions });
    expect(resolveActorRank(exact, ctx)).toBe('admin');

    const above = discordActor({ roleIds: ['between'], rolePositions: { ...rolePositions, between: 25 } });
    expect(resolveActorRank(above, ctx)).toBe('admin');
  });

  it('grants mod to a role at or above the configured mod role but below admin', () => {
    const ctx = tenantCtxWith({}, {}, tenant);
    const actor = discordActor({ roleIds: ['mod-role'], rolePositions });
    expect(resolveActorRank(actor, ctx)).toBe('mod');
  });

  it('falls back to user when no held role clears any configured tier', () => {
    const ctx = tenantCtxWith({}, {}, tenant);
    const actor = discordActor({ roleIds: ['other-role'], rolePositions });
    expect(resolveActorRank(actor, ctx)).toBe('user');
  });

  it('cascades: clearing the leadership bar unlocks admin-gated tools too, without an exact admin-role match', () => {
    const ctx = tenantCtxWith({ ban_player: 'admin' }, {}, tenant);
    const actor = discordActor({ roleIds: ['above-lead'], rolePositions: { ...rolePositions, 'above-lead': 40 } });
    expect(canRunTool(ctx, 'ban_player', {}, actor)).toBe(true);
  });

  it('an unrelated role positioned below every configured tier does not escalate', () => {
    const ctx = tenantCtxWith({ ban_player: 'admin' }, {}, tenant);
    const actor = discordActor({ roleIds: ['other-role'], rolePositions });
    expect(canRunTool(ctx, 'ban_player', {}, actor)).toBe(false);
  });
});
