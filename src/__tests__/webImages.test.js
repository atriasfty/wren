import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({ loadConfig: () => ({ openRouterApiKey: 'key' }) }));

import { sniffImageType, fetchImageForAttachment, collectImages, toVisionDataUrl } from '../ai/webImages.js';
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

describe('collectImages with prepare', () => {
  it('keeps search-result order and stops at n', async () => {
    const results = ['a', 'b', 'c', 'd', 'e'].map((k) => ({ imageUrl: `https://x.test/${k}.png`, title: k }));
    const out = await collectImages(results, 3, { fetchImpl: async () => resp(), prepare: async () => ({}) });
    expect(out.map((o) => o.meta.title)).toEqual(['a', 'b', 'c']);
  });

  it('skips images prepare rejects and keeps going', async () => {
    const results = ['a', 'b', 'c'].map((k) => ({ imageUrl: `https://x.test/${k}.png`, title: k }));
    let n = 0;
    const out = await collectImages(results, 2, { fetchImpl: async () => resp(), prepare: async () => (n++ === 0 ? null : { v: 1 }) });
    expect(out).toHaveLength(2);
    expect(out.every((o) => o.v === 1)).toBe(true);
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
    expect(policyToolKey('attach_images', {})).toBe('search_web');
    expect(names({})).toContain('attach_images');
    expect(names({ canAttachFiles: false })).not.toContain('attach_images');
  });

  it('shows candidates to the model, attaches only the ones it picks, and never leaks bytes', async () => {
    const cand = (n) => ({ buffer: Buffer.from(`full${n}`), mediaType: 'image/png', filename: `${n}.png`, visionUrl: `data:image/jpeg;base64,AAA${n}`, meta: { title: `T${n}`, source: 'site.test', pageUrl: `https://site.test/${n}` } });
    const complete = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: [{ id: '1', function: { name: 'find_images', arguments: '{"query":"q"}' } }] } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: [{ id: '2', function: { name: 'attach_images', arguments: '{"ids":["c2","c9"]}' } }] } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'here you go' } }] });
    const runTool = vi.fn(async () => ({ success: true, candidateImages: [cand(1), cand(2), cand(3)] }));
    const messages = [];
    const out = await runModelLoop({ complete, model: 'm', messages, tools: [], runTool });

    // The model saw all three pictures (as image parts) before choosing.
    const seen = messages.filter((m) => m.role === 'user' && Array.isArray(m.content));
    expect(seen).toHaveLength(3);
    expect(seen[1].content[1].image_url.url).toBe('data:image/jpeg;base64,AAA2');
    // Only c2 was attached; the bogus id c9 was ignored.
    expect(out.generatedImages).toHaveLength(1);
    expect(out.generatedImages[0].buffer.toString()).toBe('full2');
    expect(runTool).toHaveBeenCalledTimes(1); // attach_images never reaches runTool
    const toolText = messages.filter((m) => m.role === 'tool').map((m) => m.content).join('');
    expect(toolText).not.toContain('visionUrl');
    expect(toolText).toContain('"id":"c1"');
  });

  it('attaches nothing when the model rejects every candidate, and caps searches at 3', async () => {
    const cand = { buffer: Buffer.from('x'), mediaType: 'image/png', filename: 'a.png', visionUrl: 'data:image/jpeg;base64,AA', meta: { title: 't' } };
    const find = (id) => ({ id, function: { name: 'find_images', arguments: '{"query":"q"}' } });
    const complete = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: [find('1'), find('2'), find('3'), find('4')] } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: "couldn't find a good one" } }] });
    const runTool = vi.fn(async () => ({ success: true, candidateImages: [cand] }));
    const out = await runModelLoop({ complete, model: 'm', messages: [], tools: [], runTool });
    expect(runTool).toHaveBeenCalledTimes(3);
    expect(out.generatedImages).toHaveLength(0);
  });

  it('cannot attach a candidate in the same turn it was found (the model has not seen it yet)', async () => {
    const cand = { buffer: Buffer.from('x'), mediaType: 'image/png', filename: 'a.png', visionUrl: 'data:image/jpeg;base64,AA', meta: { title: 't' } };
    const complete = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: [
        { id: '1', function: { name: 'find_images', arguments: '{"query":"q"}' } },
        { id: '2', function: { name: 'attach_images', arguments: '{"ids":["c1"]}' } },
      ] } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: [{ id: '3', function: { name: 'attach_images', arguments: '{"ids":["c1"]}' } }] } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'done' } }] });
    const messages = [];
    const out = await runModelLoop({ complete, model: 'm', messages, tools: [], runTool: vi.fn(async () => ({ success: true, candidateImages: [cand] })) });
    const toolTexts = messages.filter((m) => m.role === 'tool').map((m) => m.content);
    expect(toolTexts[1]).toContain('have not seen those images yet');
    expect(out.generatedImages).toHaveLength(1); // only the later, informed attach
  });

  it('tells the model nothing was attached when it runs out of steps mid-search', async () => {
    const cand = { buffer: Buffer.from('x'), mediaType: 'image/png', filename: 'a.png', visionUrl: 'data:image/jpeg;base64,AA', meta: { title: 't' } };
    const complete = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: [{ id: '1', function: { name: 'find_images', arguments: '{"query":"q"}' } }] } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'ok' } }] });
    const messages = [];
    const out = await runModelLoop({ complete, model: 'm', messages, tools: [], maxSteps: 1, runTool: vi.fn(async () => ({ success: true, candidateImages: [cand] })) });
    expect(out.forcedFinal).toBe(true);
    expect(messages.at(-1).content).toContain('no image has been attached');
  });

  it('refuses attach_images with no ids', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: [{ id: '1', function: { name: 'attach_images', arguments: '{}' } }] } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'ok' } }] });
    const messages = [];
    const out = await runModelLoop({ complete, model: 'm', messages, tools: [], runTool: vi.fn() });
    expect(out.generatedImages).toHaveLength(0);
    expect(messages.find((m) => m.role === 'tool').content).toContain('ids is required');
  });
});

describe('toVisionDataUrl', () => {
  it('downscales a real image to a small JPEG data URL and rejects garbage', async () => {
    const sharp = (await import('sharp')).default;
    const big = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#336699' } }).png().toBuffer();
    const url = await toVisionDataUrl(big);
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    const out = Buffer.from(url.split(',')[1], 'base64');
    const meta = await sharp(out).metadata();
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(768);
    expect(await toVisionDataUrl(Buffer.from('not an image'))).toBeNull();
  });
});
