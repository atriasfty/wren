import { pipeline } from '@xenova/transformers';

let embedderPromise = null;
function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedderPromise;
}

export async function embedText(text) {
  const model = await getEmbedder();
  const out = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

export async function embedBatch(texts) {
  const model = await getEmbedder();
  const results = [];
  for (const t of texts) {
    const out = await model(t, { pooling: 'mean', normalize: true });
    results.push(Array.from(out.data));
  }
  return results;
}