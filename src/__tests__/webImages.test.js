import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({ loadConfig: () => ({ openRouterApiKey: 'key' }) }));

import { sniffImageType, fetchImageForAttachment, collectImages } from '../ai/webImages.js';
import { getToolsForMistral, policyToolKey, DISCORD_ONLY_TOOLS } from '../ai/tools.js';
import { runModelLoop } from '../ai/loop.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

function resp({ status = 200, type = 'image/png', body = PNG, length } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => ({ 'content-type': type, 'content-length': length }[k.toLowerCase()] ?? null) },
    body: new globalThis.ReadableStream({ start(c) { c.enqueue(new Uint8Array(body)); c.close(); } }),
    arrayBuffer: async () => body,
  };
}

describe('fetchImageForAttachment', () => {
  it('accepts a real image', async () => {
    const img = await fetchImageForAttachment('https://x.test/a.png', { fetchImpl: async () => resp() });
    expect(img.mediaType).toBe('image/png');
    expect(img.buffer.length).toBe(PNG.length);
  });

  it('rejects HTML served as an image, wrong content types, errors and oversize bodies', async () => {
    const html = Buffer.from('<html><body>not an image at all</body></html>');
    expect(await fetchImageForAttachment('u', { fetchImpl: async () => resp({ body: html }) })).toBeNull();
    expect(await fetchImageForAttachment('u', { fetchImpl: async () => resp({ type: 'text/html' }) })).toBeNull();
    expect(await fetchImageForAttachment('u', { fetchImpl: async () => resp({ status: 404 }) })).toBeNull();
    expect(await fetchImageForAttachment('u', { fetchImpl: async () => resp({ length: String(50 * 1024 * 1024) }) })).toBeNull();
    expect(await fetchImageForAttachment('u', { fetchImpl: async () => { throw new Error('URL resolves to a private/internal address'); } })).toBeNull();
  });

  it('sniffs types from magic bytes', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('not an image here'))).toBeNull();
  });
});

describe('collectImages', () => {
  it('falls back to the thumbnail and stops at n', async () => {
    const fetchImpl = vi.fn(async (u) => (u.includes('bad') ? resp({ status: 403 }) : resp()));
    const results = [
      { imageUrl: 'https://bad.test/1.png', thumbnailUrl: 'https://ok.test/t1.png', title: 'one' },
      { imageUrl: 'https://ok.test/2.png', thumbnailUrl: '', title: 'two' },
      { imageUrl: 'https://ok.test/3.png', thumbnailUrl: '', title: 'three' },
    ];
    const out = await collectImages(results, 2, { fetchImpl });
    expect(out.map((o) => o.meta.title)).toEqual(['one', 'two']);
    expect(out[0].filename).toBe('1-image.png');
  });
});

describe('find_images wiring', () => {
  it('is Discord-only, hidden in voice, and governed by the search_web policy', () => {
    expect(DISCORD_ONLY_TOOLS.has('find_images')).toBe(true);
    const names = (o) => getToolsForMistral(o).map((t) => t.function.name);
    expect(names({})).toContain('find_images');
    expect(names({ canAttachFiles: false })).not.toContain('find_images');
    expect(names({ isDiscordActor: false })).not.toContain('find_images');
    expect(policyToolKey('find_images', {})).toBe('search_web');
  });

  it('loop attaches web images, strips bytes from the tool text, and caps a reply at 4', async () => {
    const img = (n) => ({ buffer: Buffer.from('x'), mediaType: 'image/png', filename: `${n}.png` });
    const call = (id) => ({ id, function: { name: 'find_images', arguments: '{"query":"q","count":2}' } });
    const complete = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: [call('1'), call('2'), call('3')] } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'here you go' } }] });
    const runTool = vi.fn(async () => ({ success: true, images: [], attachedImages: [img(1), img(2)] }));
    const messages = [];
    const out = await runModelLoop({ complete, model: 'm', messages, tools: [], runTool });
    expect(runTool).toHaveBeenCalledTimes(2);
    expect(out.generatedImages).toHaveLength(4);
    expect(messages.filter((m) => m.role === 'tool').every((m) => !m.content.includes('attachedImages'))).toBe(true);
  });
});
