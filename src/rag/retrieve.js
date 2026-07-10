import { embedText } from './embed.js';
import { readVectorStore } from './store.js';

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
  return scored;
}