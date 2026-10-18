// Real web search + page reads for the live-web suite (--suite web). The
// provider is chosen with --search brave|exa (WRENBENCH_SEARCH), so the same
// model can be benchmarked on different search backends. read_webpage mirrors
// the production executor: SSRF-safe fetch, scripts/styles stripped, markdown
// capped at 8000 chars per page.
import { webSearch as braveSearch } from '../src/integrations/brave.js';
import { webSearch as exaSearch, webAnswer as exaAnswer } from '../src/integrations/exa.js';
import { safeFetch, readTextCapped } from '../src/ai/ssrf.js';

const PROVIDERS = {
  brave: braveSearch,
  exa: exaSearch,
  // Answer API: returns { answer, sources } in place of a result list.
  'exa-answer': exaAnswer,
};

export const searchProvider = () => process.env.WRENBENCH_SEARCH || 'brave';

// Per-provider search latency, for the end-of-run summary.
export const searchTimings = [];

export async function liveWebTool(name, args) {
  if (name === 'search_web') {
    const provider = searchProvider();
    const search = PROVIDERS[provider];
    if (!search) throw new Error(`unknown search provider "${provider}"`);
    const start = Date.now();
    // Production asks for 4; --search-count overrides it for experiments.
    const out = await search(String(args.query || ''), { count: Number(process.env.WRENBENCH_SEARCH_COUNT) || 4 });
    searchTimings.push(Date.now() - start);
    return Array.isArray(out) ? { success: true, results: out } : { success: true, ...out };
  }
  const TurndownService = (await import('turndown')).default;
  const turndown = new TurndownService();
  const results = [];
  for (const url of (Array.isArray(args.urls) ? args.urls : []).slice(0, 5)) {
    try {
      const resp = await safeFetch(url);
      if (!resp.ok) { results.push({ url, error: `HTTP ${resp.status} ${resp.statusText}` }); continue; }
      const html = (await readTextCapped(resp))
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
      results.push({ url, content: turndown.turndown(html).slice(0, 8000) });
    } catch (e) {
      results.push({ url, error: e.message });
    }
  }
  return { success: true, results };
}
