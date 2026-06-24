import { describe, it, expect } from 'vitest';
import { canRunTool, resolveActorRank, denialReason } from '../ai/policy.js';

function tenantCtxWith(policy, roleSlots = {}) {
  return { policy, roleSlots, tenantId: 'test', tenant: {} };
}

function discordActor({ id = '1', owner = false, admin = false, roleIds = [] } = {}) {
  const guild = { ownerId: owner ? id : '999' };
  const perms = { has: (p) => (p === 'Administrator' ? admin : false) };
  const member = {
    id,
    guild,
    permissions: perms,
    roles: { cache: { has: (rid) => roleIds.includes(rid) } },
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
