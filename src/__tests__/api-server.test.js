import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { hashToken } from '../tenant/crypto.js';

const mocks = vi.hoisted(() => ({
  findTenantByTokenHash: vi.fn(),
  resolveTenantById: vi.fn(),
  runAssistantPipeline: vi.fn(),
}));

vi.mock('../tenant/store.js', () => ({
  findTenantByTokenHash: (...a) => mocks.findTenantByTokenHash(...a),
  updateSubscription: vi.fn(),
}));

vi.mock('../tenant/resolve.js', () => ({
  resolveTenantById: (...a) => mocks.resolveTenantById(...a),
  setEncryptionKey: vi.fn(),
}));

vi.mock('../ai/pipeline.js', () => ({
  runAssistantPipeline: (...a) => mocks.runAssistantPipeline(...a),
}));

vi.mock('../api/mcp.js', () => ({
  createMcpRouter: () => {
    const noop = (_req, res) => res.status(404).end();
    return noop;
  },
}));

vi.mock('../config.js', () => ({
  loadConfig: () => ({ tenantSecretEncKey: Buffer.alloc(32), apiPort: 0 }),
}));

import { createApiServer } from '../api/server.js';

const TOKEN = 'wren_test_token_abc';
const TOKEN_HASH = hashToken(TOKEN);

function tenantCtx() {
  return {
    tenantId: 'guild-1',
    tenant: {
      tenantId: 'guild-1',
      displayName: 'Test Server',
      botDisplayName: 'Wren',
      erlcServerKey: 'SUPER-SECRET-ERLC-KEY',
      powToken: 'SUPER-SECRET-POW-TOKEN',
      subscriptionTier: 'pro',
    },
    sources: [{ kind: 'website', ref: 'https://x', enabled: true }],
    policy: { search_web: 'user' },
    roleSlots: {},
    memory: [],
  };
}

describe('REST API', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.findTenantByTokenHash.mockImplementation(async (hash) =>
      hash === TOKEN_HASH ? { tenantId: 'guild-1', scopes: ['chat'], tokenHash: hash } : null,
    );
    mocks.resolveTenantById.mockResolvedValue(tenantCtx());
    mocks.runAssistantPipeline.mockResolvedValue({ text: 'answer', error: null });
    app = await createApiServer(null);
  });

  describe('health & headers', () => {
    it('serves /healthz without auth', async () => {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('sets hardening headers on every response', async () => {
      const res = await request(app).get('/healthz');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['strict-transport-security']).toContain('max-age=');
    });
  });

  describe('authentication', () => {
    it('rejects requests without a bearer token', async () => {
      const res = await request(app).post('/v1/chat').send({ question: 'hi' });
      expect(res.status).toBe(401);
    });

    it('rejects unknown tokens', async () => {
      const res = await request(app)
        .post('/v1/chat')
        .set('Authorization', 'Bearer wrong-token')
        .send({ question: 'hi' });
      expect(res.status).toBe(401);
      expect(mocks.runAssistantPipeline).not.toHaveBeenCalled();
    });

    it('rejects tokens whose scopes do not include a known scope', async () => {
      mocks.findTenantByTokenHash.mockResolvedValue({ tenantId: 'guild-1', scopes: ['bogus'], tokenHash: TOKEN_HASH });
      const res = await request(app)
        .post('/v1/chat')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ question: 'hi' });
      expect(res.status).toBe(403);
    });

    it('never receives the raw token in the store lookup — only its hash', async () => {
      await request(app).get('/v1/info').set('Authorization', `Bearer ${TOKEN}`);
      expect(mocks.findTenantByTokenHash).toHaveBeenCalledWith(TOKEN_HASH);
      const args = mocks.findTenantByTokenHash.mock.calls.flat();
      expect(args).not.toContain(TOKEN);
    });

    it('404s when the token maps to a tenant that no longer exists', async () => {
      mocks.resolveTenantById.mockResolvedValue(null);
      const res = await request(app)
        .post('/v1/chat')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ question: 'hi' });
      expect(res.status).toBe(404);
    });
  });

  describe('/v1/chat validation', () => {
    it('requires a question', async () => {
      const res = await request(app)
        .post('/v1/chat')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('rejects non-string questions', async () => {
      const res = await request(app)
        .post('/v1/chat')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ question: { $gt: '' } });
      expect(res.status).toBe(400);
    });

    it('rejects questions over 4000 chars', async () => {
      const res = await request(app)
        .post('/v1/chat')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ question: 'x'.repeat(4001) });
      expect(res.status).toBe(400);
    });

    it('answers a valid question with an api-kind actor (no Discord privileges)', async () => {
      const res = await request(app)
        .post('/v1/chat')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ question: 'what are the rules?' });
      expect(res.status).toBe(200);
      expect(res.body.text).toBe('answer');
      const [, opts] = mocks.runAssistantPipeline.mock.calls[0];
      expect(opts.actor.kind).toBe('api');
    });

    it('returns a generic 500 without internal details when the pipeline throws', async () => {
      mocks.runAssistantPipeline.mockRejectedValue(new Error('pg: connection refused at 10.0.0.5'));
      const res = await request(app)
        .post('/v1/chat')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ question: 'hi' });
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
    });
  });

  describe('/v1/info data exposure', () => {
    it('returns only non-sensitive tenant fields', async () => {
      const res = await request(app).get('/v1/info').set('Authorization', `Bearer ${TOKEN}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        tenantId: 'guild-1',
        displayName: 'Test Server',
        botDisplayName: 'Wren',
        sourcesCount: 1,
        policyCount: 1,
      });
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('SUPER-SECRET-ERLC-KEY');
      expect(raw).not.toContain('SUPER-SECRET-POW-TOKEN');
    });
  });

  describe('rate limiting', () => {
    it('returns 429 after 20 requests in a window', async () => {
      let last;
      for (let i = 0; i < 21; i++) {
        last = await request(app).get('/v1/info').set('Authorization', `Bearer ${TOKEN}`);
      }
      expect(last.status).toBe(429);
    });

    it('rate limits per token, not globally', async () => {
      const token2 = 'wren_other_token';
      const hash2 = hashToken(token2);
      mocks.findTenantByTokenHash.mockImplementation(async (hash) =>
        [TOKEN_HASH, hash2].includes(hash) ? { tenantId: 'guild-1', scopes: ['chat'], tokenHash: hash } : null,
      );
      for (let i = 0; i < 21; i++) {
        await request(app).get('/v1/info').set('Authorization', `Bearer ${TOKEN}`);
      }
      const other = await request(app).get('/v1/info').set('Authorization', `Bearer ${token2}`);
      expect(other.status).toBe(200);
    });
  });
});
