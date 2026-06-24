const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search';

export async function webSearch(query, { count = 5 } = {}) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) {
    const err = new Error('BRAVE_SEARCH_API_KEY is not set');
    err.code = 'missing_key';
    throw err;
  }
  const url = `${BRAVE_URL}?q=${encodeURIComponent(query)}&count=${count}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
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