import { embedText } from './embed.js';
import { readVectorStore } from './store.js';

// Vectors are generated with normalize: true (unit length),
// so dot product is mathematically equivalent to cosine similarity.
// Avoiding magnitude calculation and Math.sqrt saves significant CPU.
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