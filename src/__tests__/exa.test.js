import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function mockFetch(body, { ok = true, status = 200 } = {}) {
  globalThis.fetch = vi.fn(async () => ({
    ok, status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }));
}

describe('exa', () => {
  let exa;
  beforeEach(async () => {
    process.env.EXA_API_KEY = 'k';
    vi.resetModules();
    exa = await import('../integrations/exa.js');
  });
  afterEach(() => { delete process.env.EXA_API_KEY; });

  it('webSearch sends the key, truncates the query and maps results', async () => {
    mockFetch({ results: [{ title: 'T', url: 'https://a.test', highlights: ['one', 'two'] }] });
    const out = await exa.webSearch('x'.repeat(500), { count: 3 });
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://api.exa.ai/search');
    expect(init.headers['x-api-key']).toBe('k');
    const body = JSON.parse(init.body);
    expect(body.query).toHaveLength(300);
    expect(body.numResults).toBe(3);
    expect(out).toEqual([{ title: 'T', snippet: 'one … two', url: 'https://a.test' }]);
  });

  it('both searches throw a missing_key error without a key', async () => {
    delete process.env.EXA_API_KEY;
    await expect(exa.webSearch('x')).rejects.toMatchObject({ code: 'missing_key' });
    await expect(exa.imageSearch('x')).rejects.toMatchObject({ code: 'missing_key' });
  });

  it('imageSearch asks for page images, drops junk, dedupes and caps 2 per page', async () => {
    mockFetch({ results: [
      {
        title: 'Review', url: 'https://www.news.test/review', image: 'https://cdn.test/hero.jpg',
        extras: { richImageLinks: [
          { url: 'https://cdn.test/hero.jpg', alt: 'dup' },
          { url: 'https://cdn.test/site-logo.png', alt: 'logo' },
          { url: 'https://cdn.test/icon.svg' },
          { url: 'https://cdn.test/front.jpg', alt: 'Front view' },
          { url: 'https://cdn.test/back.jpg', alt: 'Back view' },
        ] },
      },
      { title: 'Other', url: 'https://other.test/p', extras: { richImageLinks: [{ url: 'https://cdn.test/other.webp' }] } },
    ] });
    const out = await exa.imageSearch('iphone');
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.contents.extras.richImageLinks).toBe(4);
    expect(out.map((o) => o.imageUrl)).toEqual(['https://cdn.test/hero.jpg', 'https://cdn.test/front.jpg', 'https://cdn.test/other.webp']);
    expect(out[0]).toMatchObject({ title: 'Review', source: 'news.test', pageUrl: 'https://www.news.test/review' });
    expect(out[1].title).toBe('Front view');
    expect(out[2].title).toBe('Other');
  });

  it('isUsableImageUrl drops real junk but keeps product photos with look-alike words', () => {
    const ok = ['https://c.test/pixel-9-pro-hero.jpg', 'https://c.test/iconic-mustang-1967.jpg', 'https://c.test/Badger.jpg', 'https://c.test/silicon-wafer.jpg', 'https://c.test/a.jpg?trackingId=5', 'https://c.test/avatar-fire-and-ash-poster.jpg'];
    const bad = ['https://c.test/site-logo.png', 'https://c.test/assets/icons/x.png', 'https://c.test/spacer.gif', 'https://c.test/a.svg', 'https://c.test/favicon.ico', 'https://c.test/1x1.gif', 'ftp://c.test/a.jpg', 'not a url'];
    for (const u of ok) expect(exa.isUsableImageUrl(u), u).toBe(true);
    for (const u of bad) expect(exa.isUsableImageUrl(u), u).toBe(false);
  });

  it('asks Exa to moderate both kinds of search', async () => {
    mockFetch({ results: [] });
    await exa.webSearch('x');
    await exa.imageSearch('x');
    for (const call of globalThis.fetch.mock.calls) expect(JSON.parse(call[1].body).moderation).toBe(true);
  });

  it('imageSearch surfaces API errors with a status', async () => {
    mockFetch({ error: 'nope' }, { ok: false, status: 402 });
    await expect(exa.imageSearch('x')).rejects.toMatchObject({ status: 402 });
  });
});
