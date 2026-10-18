import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({ loadConfig: () => ({ openRouterApiKey: 'key' }) }));

import { generateImage, IMAGE_MODEL } from '../ai/imageGen.js';
import { runModelLoop } from '../ai/loop.js';
import { TOOL_NAMES, DISCORD_ONLY_TOOLS } from '../ai/tools.js';

describe('generateImage', () => {
  it('calls the OpenRouter images API and decodes the result', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('png-bytes').toString('base64'), media_type: 'image/png' }] }),
    }));
    const img = await generateImage({ prompt: 'a cat', aspectRatio: '16:9', fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/images');
    expect(JSON.parse(init.body)).toEqual({ model: IMAGE_MODEL, prompt: 'a cat', aspect_ratio: '16:9', n: 1 });
    expect(img.buffer.toString()).toBe('png-bytes');
    expect(img.filename).toBe('wren-image.png');
  });

  it('falls back to 1:1 for an unsupported ratio and throws on API errors', async () => {
    const ok = vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ b64_json: 'AAAA' }] }) }));
    await generateImage({ prompt: 'x', aspectRatio: '21:9', fetchImpl: ok });
    expect(JSON.parse(ok.mock.calls[0][1].body).aspect_ratio).toBe('1:1');
    const bad = vi.fn(async () => ({ ok: false, status: 402, text: async () => 'no credits' }));
    await expect(generateImage({ prompt: 'x', fetchImpl: bad })).rejects.toThrow('402');
  });
});

describe('generate_image tool wiring', () => {
  it('is a discord-only tool', () => {
    expect(TOOL_NAMES).toContain('generate_image');
    expect(DISCORD_ONLY_TOOLS.has('generate_image')).toBe(true);
  });

  it('loop collects generated images and keeps bytes out of the tool message', async () => {
    const img = { buffer: Buffer.from('x'), mediaType: 'image/png', filename: 'wren-image.png' };
    const complete = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: [{ id: '1', function: { name: 'generate_image', arguments: '{"prompt":"a cat"}' } }] } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: "here's your image" } }] });
    const messages = [];
    const out = await runModelLoop({
      complete, model: 'm', messages, tools: [],
      runTool: async () => ({ success: true, generatedImage: img }),
    });
    expect(out.generatedImages).toEqual([img]);
    expect(out.text).toBe("here's your image");
    expect(messages.find((m) => m.role === 'tool').content).not.toContain('generatedImage');
  });
});

describe('check_image_quota tool', () => {
  it('is registered and discord-only', () => {
    expect(TOOL_NAMES).toContain('check_image_quota');
    expect(DISCORD_ONLY_TOOLS.has('check_image_quota')).toBe(true);
  });
});

describe('image tool safeguards', () => {
  it('does not offer generate_image in voice mode', async () => {
    const { getToolsForMistral } = await import('../ai/tools.js');
    const names = (o) => getToolsForMistral(o).map((t) => t.function.name);
    expect(names({ isDiscordActor: true })).toContain('generate_image');
    expect(names({ isDiscordActor: true, canAttachFiles: false })).not.toContain('generate_image');
    expect(names({ isDiscordActor: true, canAttachFiles: false })).toContain('check_image_quota');
  });

  it('keys quota on the author id when the guild member is not cached', async () => {
    const { actorKey } = await import('../ai/utils.js');
    expect(actorKey({ kind: 'discord', member: null, id: '42' })).toBe('discord:42');
    expect(actorKey({ kind: 'discord', member: { id: '7' }, id: '42' })).toBe('discord:7');
  });

  it('never runs a third generate_image call in one reply', async () => {
    const img = { buffer: Buffer.from('x'), mediaType: 'image/png', filename: 'a.png' };
    const call = (id) => ({ id, function: { name: 'generate_image', arguments: '{"prompt":"p"}' } });
    const complete = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: null, tool_calls: [call('1'), call('2'), call('3')] } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'done' } }] });
    const runTool = vi.fn(async () => ({ success: true, generatedImage: img }));
    const out = await runModelLoop({ complete, model: 'm', messages: [], tools: [], runTool });
    expect(runTool).toHaveBeenCalledTimes(2);
    expect(out.generatedImages).toHaveLength(2);
  });
});
