import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

function setKey(value) { process.env.BRAVE_SEARCH_API_KEY = value; }

function mockFetchOnce(status, body, headers = {}) {
  const init = { status, headers: new Map(Object.entries(headers)) };
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
  globalThis.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => bodyText,
    json: async () => JSON.parse(bodyText),
    headers: { get: (k) => init.headers.get(k.toLowerCase()) ?? null },
  }));
}

describe('webSearch', () => {
  let webSearch;
  beforeEach(async () => {
    setKey('test_key');
    vi.resetModules();
    ({ webSearch } = await import('../integrations/brave.js'));
  });
  afterEach(() => { delete process.env.BRAVE_SEARCH_API_KEY; });

  it('throws when BRAVE_SEARCH_API_KEY missing', async () => {
    setKey('');
    vi.resetModules();
    const mod = await import('../integrations/brave.js');
    await expect(mod.webSearch('x')).rejects.toThrow(/BRAVE_SEARCH_API_KEY/);
  });

  it('maps response.web.results to plain shape', async () => {
    mockFetchOnce(200, { web: { results: [
      { title: 'A', description: 'aaa', url: 'https://a' },
      { title: 'B', description: 'bbb', url: 'https://b' },
    ]}});
    const out = await webSearch('hello');
    expect(out).toEqual([
      { title: 'A', snippet: 'aaa', url: 'https://a' },
      { title: 'B', snippet: 'bbb', url: 'https://b' },
    ]);
  });

  it('returns [] when response has no web.results', async () => {
    mockFetchOnce(200, {});
    expect(await webSearch('hi')).toEqual([]);
  });

  it('throws on non-2xx with body in message', async () => {
    mockFetchOnce(429, 'rate limited');
    await expect(webSearch('x')).rejects.toThrow(/429/);
  });
});
