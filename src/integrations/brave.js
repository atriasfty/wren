import { externalApiDuration } from '../metrics.js';

const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search';

export async function webSearch(query, { count = 5 } = {}) {
  // Brave Search has a strict 400 byte limit for the 'q' parameter.
  const safeQuery = query.length > 300 ? query.slice(0, 300) : query;
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) {
    const err = new Error('BRAVE_SEARCH_API_KEY is not set');
    err.code = 'missing_key';
    throw err;
  }
  const url = `${BRAVE_URL}?q=${encodeURIComponent(safeQuery)}&count=${count}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const __start = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        'X-Subscription-Token': key,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    externalApiDuration.observe({ service: 'brave', status: res.ok ? 'ok' : 'error' }, (Date.now() - __start) / 1000);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Brave Search error ${res.status}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return (data.web?.results || []).map((r) => ({
      title: r.title || '',
      snippet: r.description || '',
      url: r.url || '',
    }));
  } catch (err) {
    if (!err.status) externalApiDuration.observe({ service: 'brave', status: 'error' }, (Date.now() - __start) / 1000);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const BRAVE_IMAGES_URL = 'https://api.search.brave.com/res/v1/images/search';

// Image search on the same key. Strict safesearch always. The response schema
// isn't pinned in Brave's public docs, so field access is defensive: the
// original image is `properties.url`, the proxied 500px copy is `thumbnail.src`.
export async function imageSearch(query, { count = 6 } = {}) {
  const safeQuery = String(query ?? '').slice(0, 300);
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) {
    const err = new Error('BRAVE_SEARCH_API_KEY is not set');
    err.code = 'missing_key';
    throw err;
  }
  const url = `${BRAVE_IMAGES_URL}?q=${encodeURIComponent(safeQuery)}&count=${count}&safesearch=strict`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const __start = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'X-Subscription-Token': key, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    externalApiDuration.observe({ service: 'brave_images', status: res.ok ? 'ok' : 'error' }, (Date.now() - __start) / 1000);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Brave Image Search error ${res.status}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return (data.results || [])
      .map((r) => ({
        title: r.title || '',
        pageUrl: r.url || '',
        source: r.source || '',
        imageUrl: r.properties?.url || '',
        thumbnailUrl: r.thumbnail?.src || '',
        width: r.properties?.width ?? null,
        height: r.properties?.height ?? null,
      }))
      .filter((r) => r.imageUrl || r.thumbnailUrl);
  } catch (err) {
    if (!err.status) externalApiDuration.observe({ service: 'brave_images', status: 'error' }, (Date.now() - __start) / 1000);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
