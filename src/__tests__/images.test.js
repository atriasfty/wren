import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  makeImageId, parseImageId, imageAttachments, getCaption, setCaption,
  describeImagesForContext, captionImages, formatAge, _resetCaptionsForTests,
} from '../ai/images.js';

const fakeMessage = (over = {}) => ({
  id: '222', channelId: '111', createdTimestamp: Date.now() - 3 * 3600_000,
  attachments: new Map([
    ['a', { contentType: 'image/png', url: 'https://cdn/a.png' }],
    ['b', { contentType: 'text/plain', url: 'https://cdn/b.txt' }],
    ['c', { contentType: 'image/jpeg', url: 'https://cdn/c.jpg' }],
  ]),
  ...over,
});

describe('image ids', () => {
  it('round-trips and rejects junk', () => {
    expect(parseImageId(makeImageId('1', '2', 3))).toEqual({ channelId: '1', messageId: '2', index: 3 });
    expect(parseImageId('nope')).toBeNull();
    expect(parseImageId('1:2')).toBeNull();
    expect(parseImageId(undefined)).toBeNull();
  });

  it('indexes only image attachments', () => {
    expect(imageAttachments(fakeMessage()).map((i) => i.id)).toEqual(['111:222:0', '111:222:1']);
  });
});

describe('context annotations', () => {
  beforeEach(() => _resetCaptionsForTests());

  it('is empty for messages without images', () => {
    expect(describeImagesForContext(fakeMessage({ attachments: new Map() }))).toBe('');
  });

  it('shows id, age and caption when known, else points at view_image', () => {
    setCaption('111:222:0', 'a Corolla in the desert');
    const out = describeImagesForContext(fakeMessage());
    expect(out).toContain('id=111:222:0, sent 3h ago, shows: "a Corolla in the desert"');
    expect(out).toContain('id=111:222:1');
    expect(out).toContain('view_image');
  });

  it('formats ages', () => {
    expect(formatAge(10_000)).toBe('just now');
    expect(formatAge(5 * 60_000)).toBe('5m ago');
    expect(formatAge(72 * 3600_000)).toBe('3d ago');
  });
});

describe('captionImages', () => {
  beforeEach(() => _resetCaptionsForTests());

  it('stores captions and skips already-captioned images', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'a red car' } }] });
    const llm = { client: { chat: { completions: { create } } }, model: 'm' };
    await captionImages(llm, [{ id: '1:2:0', url: 'u' }]);
    expect(getCaption('1:2:0')).toBe('a red car');
    await captionImages(llm, [{ id: '1:2:0', url: 'u' }]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('swallows LLM failures', async () => {
    const create = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(captionImages({ client: { chat: { completions: { create } } }, model: 'm' }, [{ id: '1:2:0', url: 'u' }])).resolves.toBeUndefined();
    expect(getCaption('1:2:0')).toBeNull();
  });
});
