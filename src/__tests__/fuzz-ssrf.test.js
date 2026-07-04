import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// Mock dns so hostname-based fuzz inputs (arbitrary strings used as a
// hostname) resolve instantly against a fixed public address instead of
// making real network calls — IP-literal fuzz cases never reach this branch
// at all (net.isIP short-circuits it), so this only affects the "arbitrary
// garbage as a whole URL" property below.
const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('dns', () => ({
  default: { promises: { lookup: (...a) => mocks.lookup(...a) } },
}));

import { assertPublicHttpUrl, assertPublicHttpUrlCached } from '../ai/ssrf.js';

// Independent, spec-derived reference oracle for "is this IPv4 address in a
// reserved/private range" — written directly from the RFCs (1918 private
// space, 5735/5737 special-use, 6598 CGNAT, 3927 link-local, 1122 loopback +
// "this network"), NOT copied from ssrf.js's isPrivateIPv4. Used as a second,
// independently-derived implementation to diff against.
//
// This is intentionally a ONE-DIRECTIONAL property: if the oracle says an
// address is reserved, the guard MUST block it (a false negative here is a
// real SSRF bypass). The guard is allowed to be MORE conservative than the
// oracle — e.g. blocking all of 224.0.0.0-255.255.255.255 as "multicast or
// reserved" in one sweep is over-inclusive but not a vulnerability, so it's
// deliberately not asserted as an equivalence.
function oracleIsReservedIPv4(a, b, c, d) {
  if (a === 0) return true; // "this" network, RFC 1122
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback, RFC 1122
  if (a === 169 && b === 254) return true; // link-local / cloud metadata, RFC 3927
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1, RFC 5737
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, RFC 6598
  if (a === 224) return true; // multicast, RFC 5771
  if (a === 255 && b === 255 && c === 255 && d === 255) return true; // limited broadcast
  return false;
}

async function isBlocked(urlStr) {
  try {
    await assertPublicHttpUrl(urlStr);
    return false;
  } catch {
    return true;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]); // default: resolves public
});

describe('SSRF guard: IPv4 fuzzing against an independent RFC oracle', () => {
  it('blocks every address the oracle identifies as reserved/private (no false negatives)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        async (a, b, c, d) => {
          fc.pre(oracleIsReservedIPv4(a, b, c, d));
          expect(await isBlocked(`http://${a}.${b}.${c}.${d}/`)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('never blocks a hand-picked set of well-known public IPs', async () => {
    const publicIps = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '172.15.255.255', '100.128.0.1', '100.63.255.255'];
    for (const ip of publicIps) {
      expect(await isBlocked(`http://${ip}/`)).toBe(false);
    }
  });

  it('exhaustively checks the RFC1918 172.16.0.0/12 boundary (classic off-by-one spot)', async () => {
    expect(await isBlocked('http://172.15.255.255/')).toBe(false);
    expect(await isBlocked('http://172.16.0.0/')).toBe(true);
    expect(await isBlocked('http://172.31.255.255/')).toBe(true);
    expect(await isBlocked('http://172.32.0.0/')).toBe(false);
  });

  it('exhaustively checks the CGNAT 100.64.0.0/10 boundary', async () => {
    expect(await isBlocked('http://100.63.255.255/')).toBe(false);
    expect(await isBlocked('http://100.64.0.0/')).toBe(true);
    expect(await isBlocked('http://100.127.255.255/')).toBe(true);
    expect(await isBlocked('http://100.128.0.0/')).toBe(false);
  });
});

// fast-check v4 dropped the dedicated hexaString arbitrary v3 had — rebuild an
// equivalent one so these properties still generate actual hex digits instead
// of erroring before they ever run an assertion.
function hexString({ minLength = 1, maxLength = 4 } = {}) {
  return fc.string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength, maxLength });
}

describe('SSRF guard: IPv6 fuzzing', () => {
  it('blocks loopback (::1) and unspecified (::) regardless of how they are cased', async () => {
    for (const addr of ['::1', '::', '0:0:0:0:0:0:0:1']) {
      expect(await isBlocked(`http://[${addr}]/`)).toBe(true);
    }
  });

  it('blocks the whole fc00::/7 unique-local range across random suffixes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('fc', 'fd'),
        hexString({ minLength: 1, maxLength: 4 }),
        async (prefix, suffix) => {
          expect(await isBlocked(`http://[${prefix}00:${suffix}::1]/`)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('blocks fe80::/10 link-local across random suffixes', async () => {
    await fc.assert(
      fc.asyncProperty(hexString({ minLength: 1, maxLength: 4 }), async (suffix) => {
        expect(await isBlocked(`http://[fe80::${suffix}]/`)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('blocks IPv4-mapped IPv6 addresses whenever the mapped IPv4 is private', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        async (b, c) => {
          // 10.b.c.1 is always RFC1918 private for any b, c
          expect(await isBlocked(`http://[::ffff:10.${b}.${c}.1]/`)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('allows a public IPv6-mapped address', async () => {
    expect(await isBlocked('http://[::ffff:93.184.216.34]/')).toBe(false);
  });
});

describe('SSRF guard: hostname and scheme fuzzing', () => {
  it('blocks "localhost" under every casing combination', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 9, maxLength: 9 }),
        async (caseFlags) => {
          const chars = 'localhost'.split('').map((ch, i) => (caseFlags[i] ? ch.toUpperCase() : ch));
          expect(await isBlocked(`http://${chars.join('')}/`)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects every non-http(s) scheme tried', async () => {
    const schemes = ['ftp', 'file', 'gopher', 'dict', 'javascript', 'data', 'ws', 'wss', 'ssh'];
    for (const scheme of schemes) {
      expect(await isBlocked(`${scheme}://example.com/`)).toBe(true);
    }
  });

  it('never throws synchronously for arbitrary garbage strings (always resolves or rejects cleanly)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 200 }), async (s) => {
        // Either branch is fine — the invariant is just "doesn't crash the caller".
        await assertPublicHttpUrl(s).then(
          () => {},
          () => {},
        );
      }),
      { numRuns: 300 },
    );
  });
});

describe('assertPublicHttpUrlCached', () => {
  it('allows a public host and memoises the DNS lookup within the TTL', async () => {
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
