import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The SSRF base-URL guard is exercised in ssrf.test.js; here we stub it so the
// test's synthetic prc.test host doesn't trigger a real DNS lookup.
const ssrfMock = vi.hoisted(() => ({ assertPublicHttpUrlCached: vi.fn(async (u) => new URL(u)) }));
vi.mock('../ai/ssrf.js', () => ({
  assertPublicHttpUrlCached: (...a) => ssrfMock.assertPublicHttpUrlCached(...a),
  // prc.js passes this as the fetch dispatcher; the mock just needs to expose
  // the binding so the named import resolves.
  ssrfAgent: undefined,
}));

// prc.js keeps a module-level username cache; reimport fresh for each test so
// cache state can't leak between tests.
let prc;

const originalFetch = globalThis.fetch;

function tenant(key = 'server-key-1', tenantId = 'guild-1') {
  return { tenantId, tenant: { erlcServerKey: key, prcBaseUrl: 'https://prc.test/v1' } };
}

function jsonResponse(body, status = 200) {
  return { ok: status < 400, status, statusText: 'OK', json: async () => body };
}

beforeEach(async () => {
  vi.resetModules();
  prc = await import('../integrations/prc.js');
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('getOnlinePlayers', () => {
  it('parses "Name:Id" player strings into usernames and numeric ids', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      Players: [
        { Player: 'CoolCop:12345', Permission: 'Server Moderator', Team: 'Police', Callsign: '1A-01', WantedStars: 0 },
      ],
    }));
    const players = await prc.getOnlinePlayers(tenant());
    expect(players).toEqual([{
      username: 'CoolCop', userId: 12345, permission: 'Server Moderator',
      team: 'Police', callsign: '1A-01', location: undefined, wantedStars: 0,
    }]);
  });

  it('throws (and never calls the API) when the tenant has no server key, so a missing key cannot read as "0 players online"', async () => {
    await expect(prc.getOnlinePlayers({ tenantId: 'g', tenant: {} })).rejects.toThrow(/no ERLC server key/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sends the tenant server key as the Server-Key header (never in the URL)', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ Players: [] }));
    await prc.getOnlinePlayers(tenant('super-secret'));
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.headers['Server-Key']).toBe('super-secret');
    expect(String(url)).not.toContain('super-secret');
  });

  it('validates the base URL through the SSRF guard before sending the server key', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ Players: [] }));
    await prc.getOnlinePlayers(tenant());
    expect(ssrfMock.assertPublicHttpUrlCached).toHaveBeenCalledWith(expect.stringContaining('https://prc.test/v1/server'));
  });

  it('never sends the server key when the base URL fails the SSRF guard', async () => {
    ssrfMock.assertPublicHttpUrlCached.mockRejectedValueOnce(new Error('URL resolves to a private/internal address'));
    globalThis.fetch.mockResolvedValue(jsonResponse({ Players: [] }));
    await expect(prc.getOnlinePlayers(tenant())).rejects.toThrow(/private\/internal/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('findPlayer', () => {
  it('prefers exact match over prefix over substring', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      Players: [
        { Player: 'Dan:1', Permission: 'Normal' },
        { Player: 'Danny:2', Permission: 'Normal' },
        { Player: 'Jordan:3', Permission: 'Normal' },
      ],
    }));
    const p = await prc.findPlayer(tenant(), 'dan');
    expect(p.username).toBe('Dan');
  });

  it('returns null when nobody matches', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ Players: [{ Player: 'Alice:1', Permission: 'Normal' }] }));
    const p = await prc.findPlayer(tenant(), 'zzz');
    expect(p).toBeNull();
  });
});

describe('getModcalls (PM bridge feed)', () => {
  it('returns only :pm commands, with caller name and full message text', async () => {
    const now = Math.floor(Date.now() / 1000);
    globalThis.fetch.mockResolvedValue(jsonResponse({
      CommandLogs: [
        { Player: 'Player1:1', Command: ':pm wren what are the rules?', Timestamp: now },
        { Player: 'Mod1:2', Command: ':kick Baddie', Timestamp: now },
        { Player: 'Player2:3', Command: ':PM  Wren hello', Timestamp: now },
      ],
    }));
    const out = await prc.getModcalls(tenant(), { sinceTs: 1 });
    expect(out).toEqual([
      { callerName: 'Player1', message: ':pm wren what are the rules?', timestamp: now },
      { callerName: 'Player2', message: ':PM  Wren hello', timestamp: now },
    ]);
  });

  it('filters strictly newer than sinceTs', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      CommandLogs: [
        { Player: 'A:1', Command: ':pm wren old', Timestamp: 100 },
        { Player: 'B:2', Command: ':pm wren new', Timestamp: 200 },
      ],
    }));
    const out = await prc.getModcalls(tenant(), { sinceTs: 100 });
    expect(out.map((m) => m.callerName)).toEqual(['B']);
  });

  it('on first poll (sinceTs=0) ignores history older than two minutes so boot cannot replay old PMs', async () => {
    const now = Math.floor(Date.now() / 1000);
    globalThis.fetch.mockResolvedValue(jsonResponse({
      CommandLogs: [
        { Player: 'Old:1', Command: ':pm wren ancient question', Timestamp: now - 3600 },
        { Player: 'Fresh:2', Command: ':pm wren just now', Timestamp: now - 10 },
      ],
    }));
    const out = await prc.getModcalls(tenant(), { sinceTs: 0 });
    expect(out.map((m) => m.callerName)).toEqual(['Fresh']);
  });

  it('returns [] when the API errors instead of throwing', async () => {
    globalThis.fetch.mockRejectedValue(new Error('network down'));
    const out = await prc.getModcalls(tenant(), { sinceTs: 0 });
    expect(out).toEqual([]);
  });
});

describe('getRobloxUserId', () => {
  it('resolves an exact online player without hitting the Roblox API', async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({ Players: [{ Player: 'CoolCop:777', Permission: 'Normal' }] }));
    const u = await prc.getRobloxUserId(tenant(), 'coolcop');
    expect(u).toEqual({ userId: 777, username: 'CoolCop' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // only the PRC players call
  });

  it('does NOT reuse one tenant’s fuzzy match for another tenant', async () => {
    globalThis.fetch.mockImplementation(async (url, opts) => {
      const key = opts?.headers?.['Server-Key'];
      if (key === 'key-A') return jsonResponse({ Players: [{ Player: 'Johnathan:1', Permission: 'Normal' }] });
      if (key === 'key-B') return jsonResponse({ Players: [{ Player: 'Johnny:2', Permission: 'Normal' }] });
      return jsonResponse({ data: [] });
    });

    const a = await prc.getRobloxUserId(tenant('key-A', 'guild-A'), 'john');
    expect(a.username).toBe('Johnathan');

    // With a shared cache this would wrongly return Johnathan for guild-B.
    const b = await prc.getRobloxUserId(tenant('key-B', 'guild-B'), 'john');
    expect(b.username).toBe('Johnny');
  });

  it('falls back to the Roblox username API for offline players and caches the exact result', async () => {
    globalThis.fetch.mockImplementation(async (url) => {
      if (String(url).includes('prc.test')) return jsonResponse({ Players: [] });
      return jsonResponse({ data: [{ id: 555, name: 'OfflineGuy' }] });
    });
    const first = await prc.getRobloxUserId(tenant(), 'OfflineGuy');
    expect(first).toEqual({ userId: 555, username: 'OfflineGuy' });

    const callsAfterFirst = globalThis.fetch.mock.calls.length;
    const second = await prc.getRobloxUserId(tenant(), 'offlineguy');
    expect(second).toEqual({ userId: 555, username: 'OfflineGuy' });
    expect(globalThis.fetch.mock.calls.length).toBe(callsAfterFirst); // cache hit, no new calls
  });

  it('rejects names that are too short without calling any API', async () => {
    const u = await prc.getRobloxUserId(tenant(), 'ab');
    expect(u).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('moderation command construction', () => {
  function mockPlayersAndCommand(players) {
    const commands = [];
    globalThis.fetch.mockImplementation(async (url, opts) => {
      if (opts?.method === 'POST' && String(url).includes('/server/command')) {
        commands.push(JSON.parse(opts.body).command);
        return jsonResponse({});
      }
      return jsonResponse({ Players: players });
    });
    return commands;
  }

  it('banPlayer bans by numeric user id (permanent form)', async () => {
    const commands = mockPlayersAndCommand([{ Player: 'Baddie:42', Permission: 'Normal' }]);
    const r = await prc.banPlayer(tenant(), 'Baddie', 'RDM');
    expect(commands).toEqual([':ban 42 RDM']);
    expect(r.actualUsername).toBe('Baddie');
  });

  it('banPlayer includes the duration when one is given', async () => {
    const commands = mockPlayersAndCommand([{ Player: 'Baddie:42', Permission: 'Normal' }]);
    await prc.banPlayer(tenant(), 'Baddie', 'RDM', 60);
    expect(commands).toEqual([':ban 42 60 RDM']);
  });

  it('sendPrivateMessage requires both username and message', async () => {
    await expect(prc.sendPrivateMessage(tenant(), 'User1', '')).rejects.toThrow('message required');
    await expect(prc.sendPrivateMessage(tenant(), '', 'hi')).rejects.toThrow('username required');
  });

  it('surfaces the "no players" 422 as a readable error', async () => {
    globalThis.fetch.mockImplementation(async (url, opts) => {
      if (opts?.method === 'POST') return { ok: false, status: 422, statusText: 'Unprocessable', json: async () => ({}) };
      return jsonResponse({ Players: [{ Player: 'Baddie:42', Permission: 'Normal' }] });
    });
    await expect(prc.killPlayer(tenant(), 'Baddie')).rejects.toThrow('Server has no players in it');
  });
});
