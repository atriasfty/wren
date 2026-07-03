import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock('dns', () => ({
  default: { promises: { lookup: (...args) => mocks.lookup(...args) } },
}));

import { assertPublicHttpUrl, assertPublicHttpUrlCached, safeFetch } from '../ai/ssrf.js';

describe('assertPublicHttpUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  describe('protocol validation', () => {
    it('rejects ftp URLs', async () => {
      await expect(assertPublicHttpUrl('ftp://example.com/file')).rejects.toThrow('Only http/https');
    });

    it('rejects file URLs', async () => {
      await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow('Only http/https');
    });

    it('rejects javascript URLs', async () => {
      await expect(assertPublicHttpUrl('javascript:alert(1)')).rejects.toThrow();
    });

    it('rejects garbage that is not a URL', async () => {
      await expect(assertPublicHttpUrl('not a url at all')).rejects.toThrow('Invalid URL');
    });

    it('accepts plain https URLs to public hosts', async () => {
      const url = await assertPublicHttpUrl('https://example.com/page');
      expect(url.hostname).toBe('example.com');
    });
  });

  describe('blocked hostnames', () => {
    it('rejects localhost', async () => {
      await expect(assertPublicHttpUrl('http://localhost:8080/admin')).rejects.toThrow('not allowed');
    });

    it('rejects localhost case-insensitively', async () => {
      await expect(assertPublicHttpUrl('http://LOCALHOST/x')).rejects.toThrow('not allowed');
    });

    it('rejects the GCP metadata hostname', async () => {
      await expect(assertPublicHttpUrl('http://metadata.google.internal/computeMetadata/v1/')).rejects.toThrow('not allowed');
    });
  });

  describe('private IPv4 literals', () => {
    const privateIps = [
      '127.0.0.1',       // loopback
      '127.255.255.254', // loopback range
      '10.0.0.1',        // RFC1918
      '10.255.255.255',  // RFC1918
      '172.16.0.1',      // RFC1918 start
      '172.31.255.255',  // RFC1918 end
      '192.168.1.1',     // RFC1918
      '169.254.169.254', // cloud metadata / link-local
      '0.0.0.0',         // this-network
      '100.64.0.1',      // CGNAT
      '192.0.2.5',       // TEST-NET
      '224.0.0.1',       // multicast
      '255.255.255.255', // broadcast
    ];
    for (const ip of privateIps) {
      it(`rejects http://${ip}/`, async () => {
        await expect(assertPublicHttpUrl(`http://${ip}/`)).rejects.toThrow('private/internal');
      });
    }

    const publicIps = ['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '1.1.1.1'];
    for (const ip of publicIps) {
      it(`allows http://${ip}/`, async () => {
        const url = await assertPublicHttpUrl(`http://${ip}/`);
        expect(url.hostname).toBe(ip);
      });
    }
  });

  describe('DNS-resolved hostnames', () => {
    it('rejects hostnames that resolve to loopback', async () => {
      mocks.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      await expect(assertPublicHttpUrl('https://rebind.example.com/')).rejects.toThrow('private/internal');
    });

    it('rejects hostnames that resolve to RFC1918 space', async () => {
      mocks.lookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
      await expect(assertPublicHttpUrl('https://internal.example.com/')).rejects.toThrow('private/internal');
    });

    it('rejects hostnames that resolve to cloud metadata', async () => {
      mocks.lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
      await expect(assertPublicHttpUrl('https://meta.example.com/')).rejects.toThrow('private/internal');
    });

    it('rejects if ANY resolved address is private (multi-A record)', async () => {
      mocks.lookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.0.10', family: 4 },
      ]);
      await expect(assertPublicHttpUrl('https://mixed.example.com/')).rejects.toThrow('private/internal');
    });

    it('rejects hostnames that resolve to IPv6 loopback', async () => {
      mocks.lookup.mockResolvedValue([{ address: '::1', family: 6 }]);
      await expect(assertPublicHttpUrl('https://v6loop.example.com/')).rejects.toThrow('private/internal');
    });

    it('rejects hostnames that resolve to IPv6 unique-local addresses', async () => {
      mocks.lookup.mockResolvedValue([{ address: 'fd12:3456:789a::1', family: 6 }]);
      await expect(assertPublicHttpUrl('https://ula.example.com/')).rejects.toThrow('private/internal');
    });

    it('rejects hostnames that resolve to IPv4-mapped IPv6 private addresses', async () => {
      mocks.lookup.mockResolvedValue([{ address: '::ffff:10.0.0.1', family: 6 }]);
      await expect(assertPublicHttpUrl('https://mapped.example.com/')).rejects.toThrow('private/internal');
    });

    it('rejects unresolvable hostnames', async () => {
      mocks.lookup.mockResolvedValue([]);
      await expect(assertPublicHttpUrl('https://nope.invalid/')).rejects.toThrow('Could not resolve');
    });

    it('allows hostnames resolving to public IPv6', async () => {
      mocks.lookup.mockResolvedValue([{ address: '2606:4700:4700::1111', family: 6 }]);
      const url = await assertPublicHttpUrl('https://v6.example.com/');
      expect(url.hostname).toBe('v6.example.com');
    });
  });
});

describe('assertPublicHttpUrlCached', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it('allows a public host and memoises the DNS lookup within the TTL', async () => {
    // Distinct host so cache state from other tests can't interfere.
    await assertPublicHttpUrlCached('https://cache-ok.example/a');
    await assertPublicHttpUrlCached('https://cache-ok.example/b');
    await assertPublicHttpUrlCached('https://cache-ok.example/c');
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });

  it('rejects a private host and caches the rejection (no repeated lookups)', async () => {
    mocks.lookup.mockResolvedValue([{ address: '10.0.0.9', family: 4 }]);
    await expect(assertPublicHttpUrlCached('https://cache-bad.example/x')).rejects.toThrow('private/internal');
    await expect(assertPublicHttpUrlCached('https://cache-bad.example/y')).rejects.toThrow('private/internal');
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });

  it('rejects an IP literal in private space without any DNS lookup', async () => {
    await expect(assertPublicHttpUrlCached('http://169.254.169.254/latest/')).rejects.toThrow('private/internal');
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('throws on a malformed URL', async () => {
    await expect(assertPublicHttpUrlCached('http://')).rejects.toThrow();
  });
});

describe('safeFetch redirect handling', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function response(status, headers = {}) {
    return { status, ok: status < 400, headers: { get: (k) => headers[k.toLowerCase()] ?? null } };
  }

  it('returns the final response after following a public redirect', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(response(302, { location: 'http://8.8.8.8/final' }))
      .mockResolvedValueOnce(response(200));
    const res = await safeFetch('http://93.184.216.34/start');
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('blocks a redirect that points at a loopback address', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(response(302, { location: 'http://127.0.0.1/admin' }));
    await expect(safeFetch('http://93.184.216.34/start')).rejects.toThrow('private/internal');
  });

  it('blocks a redirect that points at cloud metadata', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(response(301, { location: 'http://169.254.169.254/latest/meta-data/' }));
    await expect(safeFetch('http://93.184.216.34/')).rejects.toThrow('private/internal');
  });

  it('blocks a redirect to a hostname that resolves privately (rebind via redirect)', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(response(302, { location: 'https://internal.example.com/x' }));
    mocks.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(safeFetch('http://93.184.216.34/')).rejects.toThrow('private/internal');
  });

  it('resolves relative redirect locations against the current URL', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(response(302, { location: '/next-page' }))
      .mockResolvedValueOnce(response(200));
    const res = await safeFetch('http://93.184.216.34/start');
    expect(res.status).toBe(200);
    const secondUrl = globalThis.fetch.mock.calls[1][0];
    expect(String(secondUrl)).toBe('http://93.184.216.34/next-page');
  });

  it('gives up after too many redirects', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValue(response(302, { location: 'http://93.184.216.34/loop' }));
    await expect(safeFetch('http://93.184.216.34/', { maxRedirects: 3 })).rejects.toThrow('Too many redirects');
  });

  it('always fetches with redirect: manual so undici cannot auto-follow', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(response(200));
    await safeFetch('http://93.184.216.34/');
    expect(globalThis.fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('returns a redirect response as-is when it has no location header', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(response(302, {}));
    const res = await safeFetch('http://93.184.216.34/');
    expect(res.status).toBe(302);
  });

  it('never fetches at all when the initial URL is private', async () => {
    globalThis.fetch = vi.fn();
    await expect(safeFetch('http://192.168.1.1/router')).rejects.toThrow('private/internal');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
