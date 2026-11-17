import { embedText } from './embed.js';
import { readVectorStore } from './store.js';
import { ragRetrievalDuration, ragRetrievalEmpty } from '../metrics.js';

function cosine(a, b) {
  // Optimization: Embeddings generated with `@xenova/transformers` use `normalize: true`,
  // meaning `a` and `b` are always unit vectors (magnitude of 1).
  // Thus, the cosine similarity is exactly equal to the dot product.
  // We can skip calculating magnitudes (`ma`, `mb`) and division to improve performance.
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

export async function retrieveSources(tenantCtx, question, topK = 8, { minSimilarity = 0.05 } = {}) {
  const __start = Date.now();
  try {
    if (!tenantCtx.vectorStorePath || !tenantCtx.sources || tenantCtx.sources.length === 0) return [];
    const store = await readVectorStore(tenantCtx.vectorStorePath);
    if (!store.chunks || !store.chunks.length) return [];
    const q = await embedText(question);
    // Only chunks from currently enabled sources are eligible: chunks of a
    // removed or disabled source can linger in the store and must not leak.
    const sourceWeight = new Map();
    for (const s of tenantCtx.sources) {
      if (s.enabled === false) continue;
      sourceWeight.set(`${s.kind}:${s.ref}`, s.weight ?? 1.0);
    }
    const scored = store.chunks
      .filter((c) => sourceWeight.has(`${c.sourceKind}:${c.sourceRef}`))
      .map((c) => {
        const w = sourceWeight.get(`${c.sourceKind}:${c.sourceRef}`);
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