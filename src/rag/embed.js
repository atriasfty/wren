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
  if (!texts.length) return [];
  const model = await getEmbedder();
  // ⚡ Bolt: Using native batching in transformers instead of Promise.all over individual texts
  // This reduces overhead and allows the underlying ONNX runtime to parallelize better, roughly doubling embedding speed
  const out = await model(texts, { pooling: 'mean', normalize: true });
  return out.tolist();
}