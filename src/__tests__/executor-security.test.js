import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTool } from '../ai/executor.js';
import { getDefaultPolicy } from '../tenant/store.js';

// These tests use the REAL policy module (unlike executor.test.js) so that
// deny-by-default, rank resolution, and the memory-scoping rules are exercised
// end to end.

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  addMemory: vi.fn(),
  removeMemory: vi.fn(),
  webSearch: vi.fn(),
  getOnlinePlayers: vi.fn(),
  banPlayer: vi.fn(),
  safeFetch: vi.fn(),
}));

vi.mock('../tenant/store.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    audit: (...a) => mocks.audit(...a),
    addMemory: (...a) => mocks.addMemory(...a),
    removeMemory: (...a) => mocks.removeMemory(...a),
  };
});

vi.mock('../integrations/prc.js', () => ({
  getOnlinePlayers: (...a) => mocks.getOnlinePlayers(...a),
  banPlayer: (...a) => mocks.banPlayer(...a),
}));

vi.mock('../integrations/pow.js', () => ({}));

vi.mock('../integrations/brave.js', () => ({
  webSearch: (...a) => mocks.webSearch(...a),
}));

vi.mock('../ai/ssrf.js', () => ({
  safeFetch: (...a) => mocks.safeFetch(...a),
}));

vi.mock('../discord/client.js', () => ({
  getClient: () => null,
}));

function ctxWithPolicy(policy) {
  return { tenantId: 'guild-1', tenant: {}, policy, roleSlots: {} };
}

function memberActor({ perms = [], guildOwnerId = 'other' } = {}) {
  return {
    kind: 'discord',
    member: {
      id: 'user-1',
      guild: { id: 'guild-1', ownerId: guildOwnerId },
      permissions: { has: (p) => perms.includes(p) },
      roles: { cache: { has: () => false, some: () => false } },
    },
  };
}

describe('executeTool security boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Discord-only tool isolation', () => {
    const nonDiscordActors = [
      { kind: 'in_game', playerName: 'Player1', isStaff: true },
      { kind: 'api', tokenId: 'tok1' },
      { kind: 'system' },
      null,
    ];
    const discordOnly = ['get_channel_messages', 'purge_messages', 'summarize_chat', 'get_user_info', 'get_all_channels'];

    for (const tool of discordOnly) {
      it(`${tool} is unreachable for every non-Discord actor, even a staff/system one`, async () => {
        const ctx = ctxWithPolicy(getDefaultPolicy());
        for (const actor of nonDiscordActors) {
          const result = await executeTool(ctx, tool, { channel_id: '1', user_id: '2', count: 1 }, actor);
          expect(result).toEqual({ success: false, error: 'This action is only available via Discord.' });
        }
      });
    }
  });

  describe('deny-by-default policy gate', () => {
    it('denies a gated tool when the tenant has no policy row at all', async () => {
      const ctx = ctxWithPolicy({}); // empty policy — nothing granted
      const result = await executeTool(ctx, 'ban_player', { username: 'SomeUser' }, memberActor({ perms: ['Administrator', 'ManageGuild'] }));
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Permission denied/);
      expect(mocks.banPlayer).not.toHaveBeenCalled();
    });

    it('denies search_web to a plain user when policy requires admin', async () => {
      const ctx = ctxWithPolicy({ search_web: 'admin' });
      const result = await executeTool(ctx, 'search_web', { query: 'weather' }, memberActor());
      expect(result.success).toBe(false);
      expect(mocks.webSearch).not.toHaveBeenCalled();
    });

    it('allows search_web to a plain user under the default policy', async () => {
      mocks.webSearch.mockResolvedValue([]);
      const ctx = ctxWithPolicy(getDefaultPolicy());
      const result = await executeTool(ctx, 'search_web', { query: 'weather' }, memberActor());
      expect(result.success).toBe(true);
    });

    it('a guild-owner actor passes owner-gated tools', async () => {
      mocks.getOnlinePlayers.mockResolvedValue([]);
      const ctx = ctxWithPolicy(getDefaultPolicy());
      const actor = memberActor({ guildOwnerId: 'user-1' });
      const result = await executeTool(ctx, 'pm_all_staff', { message: 'hi team' }, actor);
      expect(result.success).toBe(true);
    });

    it('a plain user cannot run owner-gated mass tools', async () => {
      const ctx = ctxWithPolicy(getDefaultPolicy());
      const result = await executeTool(ctx, 'pm_all_staff', { message: 'hi team' }, memberActor());
      expect(result.success).toBe(false);
      expect(mocks.getOnlinePlayers).not.toHaveBeenCalled();
    });
  });

  describe('memory scoping', () => {
    it('user-scope delete always passes the actor key so users can only delete their own memories', async () => {
      const ctx = ctxWithPolicy(getDefaultPolicy());
      const result = await executeTool(ctx, 'delete_memory', { type: 'user', id: 7 }, memberActor());
      expect(result.success).toBe(true);
      expect(mocks.removeMemory).toHaveBeenCalledWith('guild-1', 7, 'discord:user-1');
    });

    it('server-scope delete is denied for a plain user', async () => {
      const ctx = ctxWithPolicy(getDefaultPolicy());
      const result = await executeTool(ctx, 'delete_memory', { type: 'server', id: 7 }, memberActor());
      expect(result.success).toBe(false);
      expect(mocks.removeMemory).not.toHaveBeenCalled();
    });

    it('server-scope delete is allowed for the guild owner', async () => {
      const ctx = ctxWithPolicy(getDefaultPolicy());
      const result = await executeTool(ctx, 'delete_memory', { type: 'server', id: 7 }, memberActor({ guildOwnerId: 'user-1' }));
      expect(result.success).toBe(true);
      expect(mocks.removeMemory).toHaveBeenCalledWith('guild-1', 7);
    });

    it('user-scope save records the actor as both owner and author of the memory', async () => {
      const ctx = ctxWithPolicy(getDefaultPolicy());
      await executeTool(ctx, 'save_memory', { type: 'user', content: 'likes cats' }, memberActor());
      expect(mocks.addMemory).toHaveBeenCalledWith({
        tenantId: 'guild-1',
        scope: 'user',
        userKey: 'discord:user-1',
        content: 'likes cats',
        addedBy: 'discord:user-1',
      });
    });

    it('server-scope save is denied for a plain user', async () => {
      const ctx = ctxWithPolicy(getDefaultPolicy());
      const result = await executeTool(ctx, 'save_memory', { type: 'server', content: 'new rule' }, memberActor());
      expect(result.success).toBe(false);
      expect(mocks.addMemory).not.toHaveBeenCalled();
    });
  });

  describe('channel visibility enforcement', () => {
    function actorWithGuild(canView) {
      const actor = memberActor();
      actor.guild = {
        channels: {
          fetch: vi.fn(async () => ({
            name: 'secret-staff',
            isTextBased: () => true,
            permissionsFor: () => ({ has: () => canView }),
            messages: { fetch: vi.fn(async () => new Map()) },
            bulkDelete: vi.fn(async (n) => ({ size: n })),
          })),
        },
      };
      return actor;
    }

    it('get_channel_messages refuses channels the caller cannot see', async () => {
      const ctx = ctxWithPolicy(getDefaultPolicy());
      const result = await executeTool(ctx, 'get_channel_messages', { channel_id: '99' }, actorWithGuild(false));
      expect(result).toEqual({ success: false, error: 'You do not have access to that channel.' });
    });

    it('summarize_chat refuses channels the caller cannot see', async () => {
      const ctx = ctxWithPolicy(getDefaultPolicy());
      const result = await executeTool(ctx, 'summarize_chat', { channel_id: '99' }, actorWithGuild(false));
      expect(result).toEqual({ success: false, error: 'You do not have access to that channel.' });
    });

    it('purge_messages caps deletion count at 100 even if asked for more', async () => {
      const ctx = ctxWithPolicy({ ...getDefaultPolicy(), purge_messages: 'user' });
      const actor = actorWithGuild(true);
      const result = await executeTool(ctx, 'purge_messages', { channel_id: '99', count: 5000 }, actor);
      expect(result.success).toBe(true);
      const channel = await actor.guild.channels.fetch.mock.results[0].value;
      expect(channel.bulkDelete).toHaveBeenCalledWith(100, true);
    });
  });

  describe('read_webpage', () => {
    it('fetches at most 5 URLs no matter how many are supplied', async () => {
      mocks.safeFetch.mockResolvedValue({ ok: true, text: async () => '<p>hello</p>' });
      const ctx = ctxWithPolicy(getDefaultPolicy());
      const urls = Array.from({ length: 9 }, (_, i) => `https://example.com/${i}`);
      const result = await executeTool(ctx, 'read_webpage', { urls }, memberActor());
      expect(result.success).toBe(true);
      expect(result.results.length).toBe(5);
      expect(mocks.safeFetch).toHaveBeenCalledTimes(5);
    });

    it('reports SSRF-guard rejections per URL instead of failing the whole call', async () => {
      mocks.safeFetch
        .mockRejectedValueOnce(new Error('URL resolves to a private/internal address'))
        .mockResolvedValueOnce({ ok: true, text: async () => '<p>ok</p>' });
      const ctx = ctxWithPolicy(getDefaultPolicy());
      const result = await executeTool(ctx, 'read_webpage', { urls: ['http://10.0.0.1/', 'https://example.com/'] }, memberActor());
      expect(result.results[0].error).toMatch(/private\/internal/);
      expect(result.results[1].content).toContain('ok');
    });
  });

  it('returns a structured error for unknown tools', async () => {
    const ctx = ctxWithPolicy(getDefaultPolicy());
    const result = await executeTool(ctx, 'drop_database', {}, memberActor());
    expect(result).toEqual({ success: false, error: 'Unknown tool: drop_database' });
  });
});
