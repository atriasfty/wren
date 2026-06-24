import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chunkText, ingestDiscordMessage, removeDiscordMessageChunks } from '../rag/ingest.js';

const mocks = {
  embedBatch: vi.fn(),
  readVectorStore: vi.fn(),
  writeVectorStore: vi.fn(),
};

vi.mock('../rag/embed.js', () => ({
  embedBatch: (...args) => mocks.embedBatch(...args),
  embedText: vi.fn(),
}));

vi.mock('../rag/store.js', () => ({
  readVectorStore: (...args) => mocks.readVectorStore(...args),
  writeVectorStore: (...args) => mocks.writeVectorStore(...args),
  ensureTenantDataDir: vi.fn(),
}));

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
    const s1 = 'This is the first sentence that is relatively long but fits inside the size limit.';
    const s2 = 'This is the second sentence that will exceed the size limit when combined with the first one.';
    const text = `${s1} ${s2}`;

    const chunks = chunkText(text, 100, 20);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(s1);
    expect(chunks[1]).toContain(s2);
  });

  it('handles extremely long sentences (> size) with spaces correctly by sub-chunking on word boundaries', () => {
    const longSentence = 'word ' + Array(30).fill('hello').join(' ') + ' word';
    expect(longSentence.length).toBeGreaterThan(150);

    const chunks = chunkText(longSentence, 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
      expect(chunk.length).toBeGreaterThan(50);
    }
  });

  it('handles extremely long words (> size) without spaces by force-splitting on character indices', () => {
    const longWord = 'a'.repeat(300);
    const chunks = chunkText(longWord, 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it('handles CJK text and CJK periods', () => {
    const text = '这是一个非常长的段落，里面没有任何英文标点符号。但是它有中文句号。我们可以看看它是如何被分割的。这是第三句话。这是第四句话。这是第五句话。这是一个足够长的文本以确保它不会因为小于50字符而被过滤掉。';
    const chunks = chunkText(text, 80, 20);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(80);
    }
  });

  it('prevents infinite loops when overlap >= size', () => {
    const text = 'This is a long sentence that we will chunk. '.repeat(10);
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

describe('real-time auto-ingestion', () => {
  let tenantCtx, mockMessage;

  beforeEach(() => {
    vi.clearAllMocks();
    tenantCtx = {
      tenantId: 'guild-123',
      vectorStorePath: 'data/tenants/guild-123/vector-store.json',
      sources: [
        { kind: 'discord_channel', ref: 'chan-123', enabled: true, label: 'Main Announcements' }
      ]
    };
    mockMessage = {
      id: 'msg-456',
      content: 'This is a valid announcements message that is long enough to be auto-ingested into RAG.',
      author: { bot: false },
      channel: { id: 'chan-123' }
    };

    mocks.embedBatch.mockResolvedValue([[0.1, 0.2, 0.3]]);
    mocks.readVectorStore.mockResolvedValue({
      metadata: { totalChunks: 0 },
      chunks: []
    });
  });

  it('ignores messages from bots', async () => {
    mockMessage.author.bot = true;
    await ingestDiscordMessage(tenantCtx, mockMessage);
    expect(mocks.writeVectorStore).not.toHaveBeenCalled();
  });

  it('ignores short messages under 15 characters', async () => {
    mockMessage.content = 'Too short';
    await ingestDiscordMessage(tenantCtx, mockMessage);
    expect(mocks.writeVectorStore).not.toHaveBeenCalled();
  });

  it('ignores messages that are just URLs', async () => {
    mockMessage.content = 'https://google.com/some/long/link/path/here';
    await ingestDiscordMessage(tenantCtx, mockMessage);
    expect(mocks.writeVectorStore).not.toHaveBeenCalled();
  });

  it('ignores messages with fewer than 3 words', async () => {
    mockMessage.content = 'word1word2word3word4word5'; // > 15 chars but only 1 word
    await ingestDiscordMessage(tenantCtx, mockMessage);
    expect(mocks.writeVectorStore).not.toHaveBeenCalled();
  });

  it('successfully embeds and appends valid message to vector store', async () => {
    await ingestDiscordMessage(tenantCtx, mockMessage);

    expect(mocks.embedBatch).toHaveBeenCalledWith([mockMessage.content]);
    expect(mocks.writeVectorStore).toHaveBeenCalledWith(
      tenantCtx.vectorStorePath,
      expect.objectContaining({
        chunks: [
          {
            id: 0,
            text: mockMessage.content,
            embedding: [0.1, 0.2, 0.3],
            sourceKind: 'discord_channel',
            sourceRef: 'chan-123',
            label: 'Main Announcements',
            messageId: 'msg-456'
          }
        ]
      })
    );
  });

  it('updates existing chunks if the same message ID is ingested again (edit event)', async () => {
    mocks.readVectorStore.mockResolvedValue({
      metadata: { totalChunks: 1 },
      chunks: [
        {
          id: 0,
          text: 'Old message content that was edited',
          embedding: [0.9, 0.9, 0.9],
          sourceKind: 'discord_channel',
          sourceRef: 'chan-123',
          label: 'Main Announcements',
          messageId: 'msg-456'
        }
      ]
    });

    await ingestDiscordMessage(tenantCtx, mockMessage);

    expect(mocks.writeVectorStore).toHaveBeenCalledWith(
      tenantCtx.vectorStorePath,
      expect.objectContaining({
        chunks: [
          {
            id: 0,
            text: mockMessage.content,
            embedding: [0.1, 0.2, 0.3],
            sourceKind: 'discord_channel',
            sourceRef: 'chan-123',
            label: 'Main Announcements',
            messageId: 'msg-456'
          }
        ]
      })
    );
  });

  it('removeDiscordMessageChunks removes chunks matching messageId', async () => {
    mocks.readVectorStore.mockResolvedValue({
      metadata: { totalChunks: 2 },
      chunks: [
        { id: 0, text: 'First chunk', messageId: 'msg-456' },
        { id: 1, text: 'Second chunk', messageId: 'msg-789' }
      ]
    });

    await removeDiscordMessageChunks(tenantCtx, 'msg-456');

    expect(mocks.writeVectorStore).toHaveBeenCalledWith(
      tenantCtx.vectorStorePath,
      expect.objectContaining({
        chunks: [
          { id: 0, text: 'Second chunk', messageId: 'msg-789' }
        ]
      })
    );
  });
});
