import { describe, it, expect, vi, beforeEach } from 'vitest';

// Each test text is assigned a fixed, distinct dimension so cosine similarity
// orders them deterministically without needing a real model.
const VEC_DIM = 16;
function embeddingFor(text) {
  const v = new Array(VEC_DIM).fill(0);
  // Pick the dimension based on the first character of the text.
  const seed = (text || '').charCodeAt(0) || 0;
  v[seed % VEC_DIM] = 1.0;
  return v;
}

vi.mock('../rag/embed.js', () => ({
  embedText: vi.fn(async (text) => embeddingFor(text)),
}));

vi.mock('../rag/store.js', () => ({
  readVectorStore: vi.fn(async () => ({
    chunks: [
      // First letters: 'r', 'w', 'z' — all map to different dimensions.
      { id: 0, text: 'rules doc', embedding: embeddingFor('rules doc'), sourceKind: 'manual_doc', sourceRef: 'rules.txt', label: 'Rules' },
      { id: 1, text: 'website faq', embedding: embeddingFor('website faq'), sourceKind: 'website', sourceRef: 'https://example.com', label: 'FAQ' },
      { id: 2, text: 'random chatter', embedding: embeddingFor('random chatter'), sourceKind: 'discord_channel', sourceRef: '123', label: 'General' },
    ],
  })),
}));

describe('retrieveSources', () => {
  let retrieveSources;
  beforeEach(async () => {
    vi.resetModules();
    ({ retrieveSources } = await import('../rag/retrieve.js'));
  });

  it('returns chunks sorted by similarity', async () => {
    const ctx = {
      tenantId: 't', tenant: {},
      sources: [
        { kind: 'manual_doc', ref: 'rules.txt', weight: 1.0 },
        { kind: 'website', ref: 'https://example.com', weight: 1.0 },
        { kind: 'discord_channel', ref: '123', weight: 1.0 },
      ],
      vectorStorePath: 'unused',
    };
    const out = await retrieveSources(ctx, 'rules', 3);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].chunk.text).toBe('rules doc');
  });

  it('applies per-source weight multiplier', async () => {
    const ctx = {
      tenantId: 't', tenant: {},
      sources: [
        { kind: 'manual_doc', ref: 'rules.txt', weight: 0.1 },
        { kind: 'website', ref: 'https://example.com', weight: 2.0 },
      ],
      vectorStorePath: 'unused',
    };
    const out = await retrieveSources(ctx, 'website', 3);
    expect(out[0].chunk.text).toBe('website faq');
  });

  it('returns [] when nothing matches', async () => {
    const ctx = {
      tenantId: 't', tenant: {},
      sources: [{ kind: 'manual_doc', ref: 'rules.txt', weight: 1.0 }],
      vectorStorePath: 'unused',
    };
    const out = await retrieveSources(ctx, 'zzzzzzzzzzzz', 3, { minSimilarity: 0.99 });
    expect(out).toEqual([]);
  });
});
