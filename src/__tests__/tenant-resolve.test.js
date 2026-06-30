import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = {
  getTenant: vi.fn(),
  getPolicy: vi.fn(),
  getRoleSlots: vi.fn(),
  listSources: vi.fn(),
  listMemory: vi.fn(),
  listBans: vi.fn(),
};

vi.mock('../tenant/store.js', () => ({
  getTenant: (...args) => mocks.getTenant(...args),
  getPolicy: (...args) => mocks.getPolicy(...args),
  getRoleSlots: (...args) => mocks.getRoleSlots(...args),
  listSources: (...args) => mocks.listSources(...args),
  listMemory: (...args) => mocks.listMemory(...args),
  listBans: (...args) => mocks.listBans(...args),
}));

describe('tenant-resolve and ctx', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    
    mocks.getTenant.mockResolvedValue({ displayName: 'My Guild', ownerDiscordId: 'owner-1' });
    mocks.getPolicy.mockResolvedValue({ ban_player: 'admin' });
    mocks.getRoleSlots.mockResolvedValue({ staff: 'role-123' });
    mocks.listSources.mockResolvedValue([{ kind: 'website', ref: 'https://example.com' }]);
    mocks.listMemory.mockResolvedValue([{ scope: 'server', content: 'hello' }]);
    mocks.listBans.mockResolvedValue([{ user_key: 'discord:user-123' }]);
  });

  describe('buildTenantContext', () => {
    it('returns null if the tenant does not exist in store', async () => {
      const { buildTenantContext } = await import('../tenant/ctx.js');
      mocks.getTenant.mockResolvedValue(null);

      const ctx = await buildTenantContext('guild-123', 'key');
      expect(ctx).toBeNull();
      expect(mocks.getTenant).toHaveBeenCalledWith('guild-123', 'key');
    });

    it('assembles the full tenant context successfully', async () => {
      const { buildTenantContext } = await import('../tenant/ctx.js');

      const ctx = await buildTenantContext('guild-123', 'key');
      expect(ctx).toEqual({
        tenantId: 'guild-123',
        tenant: { displayName: 'My Guild', ownerDiscordId: 'owner-1' },
        policy: { ban_player: 'admin' },
        roleSlots: { staff: 'role-123' },
        sources: [{ kind: 'website', ref: 'https://example.com' }],
        memory: [{ scope: 'server', content: 'hello' }],
        bans: new Set(['discord:user-123']),
        dataDir: 'data/tenants/guild-123',
        vectorStorePath: 'data/tenants/guild-123/vector-store.json',
      });
      expect(mocks.getPolicy).toHaveBeenCalledWith('guild-123');
      expect(mocks.getRoleSlots).toHaveBeenCalledWith('guild-123');
      expect(mocks.listSources).toHaveBeenCalledWith('guild-123', { enabledOnly: true });
      expect(mocks.listMemory).toHaveBeenCalledWith('guild-123', { limit: 200 });
      expect(mocks.listBans).toHaveBeenCalledWith('guild-123');
    });
  });

  describe('resolveTenantByGuildId and resolveTenantById caching', () => {
    it('returns null for falsy guildIds', async () => {
      const { resolveTenantByGuildId } = await import('../tenant/resolve.js');
      expect(await resolveTenantByGuildId(null)).toBeNull();
      expect(await resolveTenantByGuildId(undefined)).toBeNull();
      expect(await resolveTenantByGuildId('')).toBeNull();
    });

    it('caches buildTenantContext responses and avoids redundant database queries', async () => {
      const { resolveTenantByGuildId, resolveTenantById } = await import('../tenant/resolve.js');

      // First call: resolves from DB
      const ctx1 = await resolveTenantByGuildId('guild-123');
      expect(ctx1).not.toBeNull();
      expect(mocks.getTenant).toHaveBeenCalledTimes(1);

      // Second call: should serve from memory cache
      const ctx2 = await resolveTenantByGuildId('guild-123');
      expect(ctx2).toBe(ctx1);
      expect(mocks.getTenant).toHaveBeenCalledTimes(1);

      // resolveTenantById delegates to same caching mechanism
      const ctx3 = await resolveTenantById('guild-123');
      expect(ctx3).toBe(ctx1);
      expect(mocks.getTenant).toHaveBeenCalledTimes(1);
    });

    it('invalidates cache correctly when invalidateTenant is called', async () => {
      const { resolveTenantByGuildId, invalidateTenant } = await import('../tenant/resolve.js');

      await resolveTenantByGuildId('guild-123');
      expect(mocks.getTenant).toHaveBeenCalledTimes(1);

      invalidateTenant('guild-123');

      // Next call should query DB again
      await resolveTenantByGuildId('guild-123');
      expect(mocks.getTenant).toHaveBeenCalledTimes(2);
    });

    it('clears all cache when clearCache is called', async () => {
      const { resolveTenantByGuildId, clearCache } = await import('../tenant/resolve.js');

      await resolveTenantByGuildId('guild-123');
      await resolveTenantByGuildId('guild-456');
      expect(mocks.getTenant).toHaveBeenCalledTimes(2);

      clearCache();

      await resolveTenantByGuildId('guild-123');
      await resolveTenantByGuildId('guild-456');
      expect(mocks.getTenant).toHaveBeenCalledTimes(4);
    });

    it('clears cache when encryption key is changed via setEncryptionKey', async () => {
      const { resolveTenantByGuildId, setEncryptionKey } = await import('../tenant/resolve.js');

      await resolveTenantByGuildId('guild-123');
      expect(mocks.getTenant).toHaveBeenCalledTimes(1);

      setEncryptionKey('new-key');

      await resolveTenantByGuildId('guild-123');
      expect(mocks.getTenant).toHaveBeenCalledTimes(2);
    });

    it('respects cache expiration (TTL)', async () => {
      const { resolveTenantByGuildId } = await import('../tenant/resolve.js');

      const mockDateNow = vi.spyOn(Date, 'now');
      mockDateNow.mockReturnValue(100000);

      await resolveTenantByGuildId('guild-123');
      expect(mocks.getTenant).toHaveBeenCalledTimes(1);

      // Move time forward by 30 seconds (still within 60s TTL)
      mockDateNow.mockReturnValue(130000);
      await resolveTenantByGuildId('guild-123');
      expect(mocks.getTenant).toHaveBeenCalledTimes(1);

      // Move time forward by 61 seconds (expired TTL)
      mockDateNow.mockReturnValue(161000);
      await resolveTenantByGuildId('guild-123');
      expect(mocks.getTenant).toHaveBeenCalledTimes(2);

      mockDateNow.mockRestore();
    });
  });
});
