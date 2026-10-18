// Image generation via OpenRouter's dedicated Images API
// (POST /api/v1/images). Model: recraft/recraft-v4.1-flash.
// Request: { model, prompt, aspect_ratio, n }. Response: { data: [{ b64_json, media_type }] }.

import { loadConfig } from '../config.js';

export const IMAGE_MODEL = 'recraft/recraft-v4.1-flash';
export const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'];
const MAX_PROMPT_CHARS = 4000;
const TIMEOUT_MS = 90_000;

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

// Returns { buffer, mediaType, filename }. Throws on any failure.
export async function generateImage({ prompt, aspectRatio = '1:1', fetchImpl = fetch } = {}) {
  const text = String(prompt ?? '').trim().slice(0, MAX_PROMPT_CHARS);
  if (!text) throw new Error('prompt is required');
  const ratio = ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : '1:1';

  const res = await fetchImpl('https://openrouter.ai/api/v1/images', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loadConfig().openRouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://atriasafety.org',
      'X-Title': 'Wren',
    },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt: text, aspect_ratio: ratio, n: 1 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`image API ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const item = json?.data?.[0];
  if (!item?.b64_json) throw new Error('image API returned no image');
  const mediaType = String(item.media_type || 'image/png').split(';')[0].trim().toLowerCase();
  const buffer = Buffer.from(item.b64_json, 'base64');
  if (!buffer.length) throw new Error('image API returned an empty image');
  return { buffer, mediaType, filename: `wren-image.${EXT[mediaType] || 'png'}` };
}
