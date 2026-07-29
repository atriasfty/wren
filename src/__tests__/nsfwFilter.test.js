import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

import { refreshNsfwList, isNsfwHostname } from '../ai/nsfwFilter.js';

// refreshNsfwList rejects parses under 1000 domains as a corrupted/mangled
// fetch, so the fixture needs filler entries to clear that floor.
const FILLER = Array.from({ length: 1000 }, (_, i) => `||filler-domain-${i}.test^`).join('\n');
const SAMPLE_LIST = `[Adblock Plus]
! Title: oisd nsfw
||0-0.asia^
||0-porno.com^
||sub.blocked-example.com^
${FILLER}
`;

describe('nsfwFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses Adblock Plus entries and blocks exact matches', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, text: async () => SAMPLE_LIST });
    await refreshNsfwList();
    expect(isNsfwHostname('0-0.asia')).toBe(true);
    expect(isNsfwHostname('0-porno.com')).toBe(true);
  });

  it('blocks subdomains of a listed domain', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, text: async () => SAMPLE_LIST });
    await refreshNsfwList();
    expect(isNsfwHostname('www.sub.blocked-example.com')).toBe(true);
  });

  it('does not block unrelated hostnames', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, text: async () => SAMPLE_LIST });
    await refreshNsfwList();
    expect(isNsfwHostname('example.com')).toBe(false);
  });

  it('keeps the previous list when a refresh fails', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, text: async () => SAMPLE_LIST });
    await refreshNsfwList();
    expect(isNsfwHostname('0-0.asia')).toBe(true);

    mocks.fetch.mockRejectedValueOnce(new Error('network down'));
    await refreshNsfwList();
    expect(isNsfwHostname('0-0.asia')).toBe(true);
  });

  it('rejects a suspiciously small parse instead of adopting it', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, text: async () => SAMPLE_LIST });
    await refreshNsfwList();

    mocks.fetch.mockResolvedValueOnce({ ok: true, text: async () => '||only-one.com^' });
    await refreshNsfwList();
    expect(isNsfwHostname('0-0.asia')).toBe(true);
  });
});
