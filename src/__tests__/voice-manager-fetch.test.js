import { describe, it, expect, vi } from 'vitest';

// voice/manager.js patches globalThis.fetch at import time so onnxruntime-web
// can load local wake-word models over file:// URLs, which Node's fetch does
// not support. Every SSRF-guarded fetch (ai/ssrf.js, prc.js, pow.js) flows
// through this same patched fetch, so a non-file:// call must reach the real
// fetch with `options` (in particular the SSRF `dispatcher`) forwarded
// byte-for-byte — this test exists because that interaction was previously
// completely uncovered by the test suite.
describe('voice/manager global fetch polyfill', () => {
  it('forwards non-file:// requests to the original fetch with options untouched, and serves file:// locally', async () => {
    const fakeOriginalFetch = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = fakeOriginalFetch;

    await import('../discord/voice/manager.js');

    const dispatcherMarker = { pinned: true };
    const opts = { method: 'GET', dispatcher: dispatcherMarker };
    await globalThis.fetch('https://api.erlc.gg/v1/server', opts);
    expect(fakeOriginalFetch).toHaveBeenCalledWith('https://api.erlc.gg/v1/server', opts);

    const res = await globalThis.fetch(import.meta.url);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);

    // The file:// request must never have reached the original fetch.
    expect(fakeOriginalFetch).toHaveBeenCalledTimes(1);
  });
});
