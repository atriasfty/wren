import { safeFetch } from '../ai/ssrf.js';

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
  try {
    // [SECURITY-FIX] SSRF: use safeFetch for outbound integration calls
    const res = await safeFetch(url, {
      headers: {
        'X-Subscription-Token': key,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
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
  } finally {
    clearTimeout(timer);
  }
}