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

// Downloads candidates in small parallel batches (a sequential walk could take
// minutes when hosts are slow), keeping search-result order. Tries the original
// image then the thumbnail. `prepare(img)` may return extra fields to merge in,
// or null to reject the image (used to drop ones the model can't be shown), so
// `n` counts only images that fully qualify.
export async function collectImages(results, n, { fetchImpl, prepare } = {}) {
  const out = [];
  let i = 0;
  while (out.length < n && i < results.length) {
    const batch = results.slice(i, i + Math.max(2, n - out.length));
    i += batch.length;
    const done = await Promise.all(batch.map(async (r) => {
      for (const u of [r.imageUrl, r.thumbnailUrl]) {
        if (!u) continue;
        const img = await fetchImageForAttachment(u, { fetchImpl });
        if (!img) continue;
        const extra = prepare ? await prepare(img) : {};
        if (extra) return { ...img, ...extra, meta: r };
      }
      return null;
    }));
    for (const d of done) {
      if (d && out.length < n) out.push({ ...d, filename: `${out.length + 1}-${d.filename}` });
    }
  }
  return out;
}

// A small JPEG data URL the model can look at. Candidates are shown to the
// model at reduced size (about 768px) to keep token cost and request size sane;
// the full-size file is what gets attached if the model picks it. Returns null
// if the image can't be decoded, so undecodable candidates are never shown.
export async function toVisionDataUrl(buffer, { maxSide = 768 } = {}) {
  try {
    const sharp = (await import('sharp')).default;
    const out = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 72 })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch (err) {
    console.warn('[webImages] could not prepare image for the model:', err.message);
    return null;
  }
}
