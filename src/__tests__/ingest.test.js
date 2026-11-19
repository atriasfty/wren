import { setImmediate } from 'node:timers/promises';
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

  it('drops sub-50-char fragments when there are substantial chunks', () => {
    const long = 'This sentence is comfortably longer than fifty characters in total length.';
    const chunks = chunkText(`${long}\nTiny bit.`, 80, 10);
    expect(chunks.every((c) => c.length > 50)).toBe(true);
  });

  it('keeps a short text instead of silently indexing nothing', () => {
    const text = 'Hello world. This is a very short text.';
    expect(chunkText(text, 100, 10)).toEqual([text]);
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
    mocks.writeVectorStore.mockReset();
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

  it('writes ready Discord edits together, keeping only the last edit per message', async () => {
    const other = { ...mockMessage, id: 'msg-789' };
    const latest = { ...mockMessage, content: 'The new announcement replaces the original version of this message.' };

    await Promise.all([mockMessage, other, latest].map((message) => ingestDiscordMessage(tenantCtx, message)));

    expect(mocks.readVectorStore).toHaveBeenCalledTimes(1);
    expect(mocks.writeVectorStore).toHaveBeenCalledTimes(1);
    const [, store] = mocks.writeVectorStore.mock.calls[0];
    expect(store.metadata.totalChunks).toBe(2);
    expect(store.chunks.map(({ id, messageId, text }) => [id, messageId, text])).toEqual([
      [0, other.id, other.content],
      [1, latest.id, latest.content],
    ]);
  });

  it('starts another write after a batch reaches 32 edits', async () => {
    const chunkCounts = [];
    mocks.writeVectorStore.mockImplementation((_path, { chunks }) => { chunkCounts.push(chunks.length); });
    const messages = Array.from({ length: 33 }, (_, i) => ({ ...mockMessage, id: `message-${i}` }));
    await Promise.all(messages.map((message) => ingestDiscordMessage(tenantCtx, message)));

    expect(chunkCounts).toEqual([32, 33]);
  });

  it('does not merge an edit across a queued delete', async () => {
    let startFirstWrite;
    let releaseFirstWrite;
    const firstWriteStarted = new Promise((resolve) => { startFirstWrite = resolve; });
    const firstWriteReleased = new Promise((resolve) => { releaseFirstWrite = resolve; });
    const versions = [];
    const recordVersion = (_path, { chunks }) => {
      versions.push(chunks.find(({ messageId }) => messageId === mockMessage.id)?.text);
    };
    mocks.writeVectorStore.mockImplementationOnce(async (...args) => {
      recordVersion(...args);
      startFirstWrite();
      await firstWriteReleased;
    });
    for (let i = 0; i < 3; i++) mocks.writeVectorStore.mockImplementationOnce(recordVersion);
    const first = ingestDiscordMessage(tenantCtx, { ...mockMessage, id: 'in-flight' });
    await firstWriteStarted;
    const beforeDelete = ingestDiscordMessage(tenantCtx, mockMessage);
    await setImmediate();
    const deletion = removeDiscordMessageChunks(tenantCtx, mockMessage.id);
    const latest = { ...mockMessage, content: 'This edit was queued after the deletion and must not be lost.' };
    const afterDelete = ingestDiscordMessage(tenantCtx, latest);
    await setImmediate();
    releaseFirstWrite();
    await Promise.all([first, beforeDelete, deletion, afterDelete]);

    expect(versions).toEqual([undefined, mockMessage.content, undefined, latest.content]);
  });

  it('rejects every edit in a failed write and still runs the next write', async () => {
    const failure = new Error('disk write failed');
    mocks.writeVectorStore.mockRejectedValueOnce(failure);
    const first = ingestDiscordMessage(tenantCtx, mockMessage);
    const second = ingestDiscordMessage(tenantCtx, { ...mockMessage, id: 'msg-789' });

    expect(await Promise.allSettled([first, second])).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(mocks.writeVectorStore).toHaveBeenCalledTimes(1);
    await ingestDiscordMessage(tenantCtx, mockMessage);
    expect(mocks.writeVectorStore).toHaveBeenCalledTimes(2);
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
