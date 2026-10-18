// Downloads web images so they can be attached to a Discord reply.
// Everything goes through safeFetch (private/metadata addresses blocked, each
// redirect re-checked, oisd NSFW host list applied) and the bytes are checked
// by magic number, because a Content-Type header alone is attacker-controlled.

import { safeFetch, readBytesCapped } from './ssrf.js';

export const MAX_WEB_IMAGE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

// Returns the real image type from the file's first bytes, or null.
export function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// Returns { buffer, mediaType, filename } or null if the URL isn't a usable image.
export async function fetchImageForAttachment(url, { fetchImpl = safeFetch } = {}) {
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WrenBot/1.0; +https://discord.com)', Accept: 'image/png,image/jpeg,image/webp,image/gif' },
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    if (!res.ok) { await res.body?.cancel?.().catch(() => {}); return null; }
    const declared = String(res.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (declared && !declared.startsWith('image/') && declared !== 'application/octet-stream') {
      await res.body?.cancel?.().catch(() => {});
      return null;
    }
    const buffer = await readBytesCapped(res, MAX_WEB_IMAGE_BYTES);
    if (!buffer) return null;
    const mediaType = sniffImageType(buffer);
    if (!mediaType) return null;
    return { buffer, mediaType, filename: `image.${EXT[mediaType]}` };
  } catch (err) {
    console.warn('[webImages] fetch failed:', err.message);
    return null;
  }
}

// Walks search results in order, trying the original image then the
// thumbnail (if the provider gives one), until `n` distinct images are downloaded.
export async function collectImages(results, n, { fetchImpl } = {}) {
  const out = [];
  for (const r of results) {
    if (out.length >= n) break;
    for (const u of [r.imageUrl, r.thumbnailUrl]) {
      if (!u) continue;
      const img = await fetchImageForAttachment(u, { fetchImpl });
      if (img) {
        out.push({ ...img, filename: `${out.length + 1}-${img.filename}`, meta: r });
        break;
      }
    }
  }
  return out;
}
