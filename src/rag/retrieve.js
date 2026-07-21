import { embedText } from './embed.js';
import { readVectorStore } from './store.js';

// ⚡ Bolt Optimization: Since @xenova/transformers uses normalize: true for embeddings,
// vectors are unit length (magnitude = 1). Cosine similarity simplifies to just the dot product.
// This reduces ops from ~4 to 1 per dimension in the hot loop.
function cosine(a, b) {
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