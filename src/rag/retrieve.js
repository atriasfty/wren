import { embedText } from './embed.js';
import { readVectorStore } from './store.js';
import { ragRetrievalDuration, ragRetrievalEmpty } from '../metrics.js';

function cosine(a, b) {
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    ma += a[i] * a[i];
    mb += b[i] * b[i];
  }
  return dot / (Math.sqrt(ma) * Math.sqrt(mb) + 1e-12);
}

export async function retrieveSources(tenantCtx, question, topK = 8, { minSimilarity = 0.05 } = {}) {
  const __start = Date.now();
  try {
    if (!tenantCtx.vectorStorePath || !tenantCtx.sources || tenantCtx.sources.length === 0) return [];
    const store = await readVectorStore(tenantCtx.vectorStorePath);
    if (!store.chunks || !store.chunks.length) return [];
    const q = await embedText(question);
    const sourceWeight = new Map();
    for (const s of tenantCtx.sources) sourceWeight.set(`${s.kind}:${s.ref}`, s.weight ?? 1.0);
    const scored = store.chunks
      .map((c) => {
        const w = sourceWeight.get(`${c.sourceKind}:${c.sourceRef}`) ?? 1.0;
        return { chunk: c, score: cosine(q, c.embedding) * w };
      })
      .filter((s) => s.score > minSimilarity)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    if (scored.length === 0) ragRetrievalEmpty.inc();
    return scored;
  } finally {
    ragRetrievalDuration.observe((Date.now() - __start) / 1000);
  }
}