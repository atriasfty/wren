import { externalApiDuration } from '../metrics.js';

const EXA_URL = 'https://api.exa.ai/search';

// Web search for the search_web tool (same result shape as brave.js, which
// remains only as a benchmark baseline).
// Instant mode is Exa's lowest-latency search type; highlights put the
// relevant passage from each page in the snippet.
export async function webSearch(query, { count = 5 } = {}) {
  const key = process.env.EXA_API_KEY;
  if (!key) {
    const err = new Error('EXA_API_KEY is not set');
    err.code = 'missing_key';
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const __start = Date.now();
  try {
    const res = await fetch(EXA_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: String(query ?? '').slice(0, 300), type: 'instant', numResults: count, contents: { highlights: { maxCharacters: 400 } } }),
      signal: controller.signal,
    });
    externalApiDuration.observe({ service: 'exa', status: res.ok ? 'ok' : 'error' }, (Date.now() - __start) / 1000);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Exa Search error ${res.status}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return (data.results || []).map((r) => ({
      title: r.title || '',
      snippet: (r.highlights || []).join(' … '),
      url: r.url || '',
    }));
  } catch (err) {
    if (!err.status) externalApiDuration.observe({ service: 'exa', status: 'error' }, (Date.now() - __start) / 1000);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Exa's Answer API: Exa runs the search and writes a short cited answer
// itself, so the model gets an answer plus sources instead of raw snippets.
export async function webAnswer(query, { count = 4 } = {}) {
  const key = process.env.EXA_API_KEY;
  if (!key) {
    const err = new Error('EXA_API_KEY is not set');
    err.code = 'missing_key';
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const __start = Date.now();
  try {
    const res = await fetch('https://api.exa.ai/answer', {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, type: 'instant' }),
      signal: controller.signal,
    });
    externalApiDuration.observe({ service: 'exa_answer', status: res.ok ? 'ok' : 'error' }, (Date.now() - __start) / 1000);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Exa Answer error ${res.status}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return {
      answer: data.answer || '',
      sources: (data.citations || []).slice(0, count).map((c) => ({ title: c.title || '', url: c.url || '' })),
    };
  } catch (err) {
    if (!err.status) externalApiDuration.observe({ service: 'exa_answer', status: 'error' }, (Date.now() - __start) / 1000);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// URLs that are almost never the picture a person asked to see.
const JUNK_IMAGE_RE = /\.(svg|ico)(\?|#|$)|favicon|sprite|logo|icon|avatar|badge|pixel|tracking|spacer|1x1|placeholder|\/emoji\//i;

export function isUsableImageUrl(u) {
  try {
    const url = new URL(u);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return !JUNK_IMAGE_RE.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

// Exa has no dedicated image search: it searches pages and can return images
// from them. We ask for each page's own `image` plus up to 4 images found in
// the page (with alt text), drop obvious non-photos, dedupe, and take at most
// 2 per page so one article can't supply every candidate. Candidates come back
// in relevance order, shaped for collectImages() in ai/webImages.js.
export async function imageSearch(query, { count = 8 } = {}) {
  const key = process.env.EXA_API_KEY;
  if (!key) {
    const err = new Error('EXA_API_KEY is not set');
    err.code = 'missing_key';
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const __start = Date.now();
  try {
    const res = await fetch(EXA_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: String(query ?? '').slice(0, 300),
        type: 'auto',
        numResults: Math.min(Math.max(count, 1), 10),
        contents: { extras: { richImageLinks: 4 } },
      }),
      signal: controller.signal,
    });
    externalApiDuration.observe({ service: 'exa_images', status: res.ok ? 'ok' : 'error' }, (Date.now() - __start) / 1000);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Exa image search error ${res.status}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const seen = new Set();
    const out = [];
    for (const r of data.results || []) {
      let host = '';
      try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch { /* keep empty */ }
      const candidates = [
        ...(r.image ? [{ url: r.image, alt: '' }] : []),
        ...((r.extras?.richImageLinks) || []).map((x) => ({ url: x?.url, alt: x?.alt || '' })),
      ];
      let fromPage = 0;
      for (const c of candidates) {
        if (fromPage >= 2) break;
        if (!c.url || seen.has(c.url) || !isUsableImageUrl(c.url)) continue;
        seen.add(c.url);
        fromPage++;
        out.push({
          title: (c.alt || r.title || '').slice(0, 200),
          pageUrl: r.url || '',
          source: host,
          imageUrl: c.url,
          thumbnailUrl: '',
          width: null,
          height: null,
        });
      }
    }
    return out;
  } catch (err) {
    if (!err.status) externalApiDuration.observe({ service: 'exa_images', status: 'error' }, (Date.now() - __start) / 1000);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
