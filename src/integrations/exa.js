import { externalApiDuration } from '../metrics.js';

const EXA_URL = 'https://api.exa.ai/search';

// Same result shape as brave.js webSearch, so the two are interchangeable.
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
      body: JSON.stringify({ query, type: 'instant', numResults: count, contents: { highlights: { maxCharacters: 400 } } }),
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
