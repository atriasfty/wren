import { describe, it, expect } from 'vitest';
import { chunkText } from '../rag/ingest.js';

describe('chunkText', () => {
  it('returns empty array for null/undefined/empty input', () => {
    expect(chunkText(null)).toEqual([]);
    expect(chunkText(undefined)).toEqual([]);
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   ')).toEqual([]);
  });

  it('filters out chunks smaller than 50 characters', () => {
    const text = 'Hello world. This is a very short text.';
    expect(chunkText(text, 100, 10)).toEqual([]);
  });

  it('correctly chunks sentences and respects size limit', () => {
    // Generate text with sentences
    const s1 = 'This is the first sentence that is relatively long but fits inside the size limit.';
    const s2 = 'This is the second sentence that will exceed the size limit when combined with the first one.';
    const text = `${s1} ${s2}`;

    const chunks = chunkText(text, 100, 20);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(s1);
    // Overlap should carry some words from the end of the first chunk
    // s1 words: "This is the first sentence that is relatively long but fits inside the size limit."
    // Overlap is 20 chars. 20/5 = 4 words. Last 4 words: "inside the size limit."
    expect(chunks[1]).toContain(s2);
    expect(chunks[1]).toContain('size limit. ' + s2);
  });

  it('handles extremely long sentences (> size) with spaces correctly by sub-chunking on word boundaries', () => {
    // A single sentence with no punctuation but lots of words, longer than size 100
    const longSentence = 'word ' + Array(30).fill('hello').join(' ') + ' word';
    expect(longSentence.length).toBeGreaterThan(150);

    const chunks = chunkText(longSentence, 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
    
    // Each chunk must be <= size
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
      expect(chunk.length).toBeGreaterThan(50); // filtered for > 50
    }
  });

  it('handles extremely long words (> size) without spaces by force-splitting on character indices', () => {
    // A single word of 300 characters
    const longWord = 'a'.repeat(300);
    const chunks = chunkText(longWord, 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it('handles CJK text and CJK periods', () => {
    // Chinese periods are '。' and sometimes they have no spaces
    const text = '这是一个非常长的段落，里面没有任何英文标点符号。但是它有中文句号。我们可以看看它是如何被分割的。这是第三句话。这是第四句话。这是第五句话。这是一个足够长的文本以确保它不会因为小于50字符而被过滤掉。';
    const chunks = chunkText(text, 80, 20);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(80);
    }
  });

  it('prevents infinite loops when overlap >= size', () => {
    const text = 'This is a long sentence that we will chunk. '.repeat(10);
    // overlap = 150, size = 100
    const chunks = chunkText(text, 100, 150);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it('handles punctuation-only strings safely', () => {
    const text = '.!?.!?.!?.!?.!?.!?.!?.!?.!?.!?.!?.!?.!?.!?.!?';
    expect(chunkText(text, 100, 20)).toEqual([]);
  });
});
