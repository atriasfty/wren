import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enforceBan, recordBan } from '../discord/guards.js';
import { isBanned, addBan } from '../tenant/store.js';

vi.mock('../tenant/store.js', () => ({
  isBanned: vi.fn(),
  addBan: vi.fn()
}));

describe('guards.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('enforceBan', () => {
    const tenantCtx = { tenantId: 't123' };

    it('returns false if actor is null or undefined', async () => {
      const result = await enforceBan(tenantCtx, null);
      expect(result).toBe(false);
      expect(isBanned).not.toHaveBeenCalled();
    });

    it('returns false if actor kind is unknown', async () => {
      const result = await enforceBan(tenantCtx, { kind: 'unknown' });
      expect(result).toBe(false);
      expect(isBanned).not.toHaveBeenCalled();
    });

    it('uses tenantCtx.bans Set if available for discord actor', async () => {
      const ctx = { tenantId: 't123', bans: new Set(['discord:d123']) };
      const result = await enforceBan(ctx, { kind: 'discord', member: { id: 'd123' } });
      expect(isBanned).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('computes userKey for discord actor', async () => {
      isBanned.mockResolvedValue(true);
      const result = await enforceBan(tenantCtx, { kind: 'discord', member: { id: 'd123' } });
      expect(isBanned).toHaveBeenCalledWith('t123', 'discord:d123');
      expect(result).toBe(true);
    });

    it('uses tenantCtx.bans Set if available for in_game actor', async () => {
      const ctx = { tenantId: 't123', bans: new Set(['ingame:Player1']) };
      const result = await enforceBan(ctx, { kind: 'in_game', playerName: 'Player1' });
      expect(isBanned).not.toHaveBeenCalled();
      expect(result).toBe(true);

      const result2 = await enforceBan(ctx, { kind: 'in_game', playerName: 'Player2' });
      expect(isBanned).not.toHaveBeenCalled();
      expect(result2).toBe(false);
    });

    it('computes userKey for in_game actor', async () => {
      isBanned.mockResolvedValue(false);
      const result = await enforceBan(tenantCtx, { kind: 'in_game', playerName: 'Player1' });
      expect(isBanned).toHaveBeenCalledWith('t123', 'ingame:Player1');
      expect(result).toBe(false);
    });

    it('uses tenantCtx.bans Set if available for api actor', async () => {
      const ctx = { tenantId: 't123', bans: new Set(['api:tok_abc']) };
      const result = await enforceBan(ctx, { kind: 'api', tokenId: 'tok_abc' });
      expect(isBanned).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('computes userKey for api actor', async () => {
      isBanned.mockResolvedValue(true);
      const result = await enforceBan(tenantCtx, { kind: 'api', tokenId: 'tok_abc' });
      expect(isBanned).toHaveBeenCalledWith('t123', 'api:tok_abc');
      expect(result).toBe(true);
    });
  });

  describe('recordBan', () => {
    it('calls addBan with the correct parameters', async () => {
      const banParams = {
        tenantId: 't123',
        userKey: 'discord:d123',
        reason: 'spam',
        bannedBy: 'admin1'
      };
      await recordBan(banParams);
      expect(addBan).toHaveBeenCalledWith(banParams);
    });
  });
});
