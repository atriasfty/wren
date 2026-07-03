import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { query } from '../db/pool.js';

vi.mock('../db/pool.js', () => ({ query: vi.fn() }));
vi.mock('../tenant/store.js', () => ({ logAudit: vi.fn() }));
vi.mock('../tenant/resolve.js', () => ({ resolveTenantById: vi.fn() }));
vi.mock('../rag/retrieve.js', () => ({ retrieveSources: vi.fn() }));
vi.mock('../ai/executor.js', () => ({ executeTool: vi.fn() }));

import { createMcpRouter } from '../api/mcp.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mcp', createMcpRouter(null));
  return app;
}

describe('MCP endpoint authentication', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it('rejects SSE connections without any token', async () => {
    const res = await request(app).get('/api/mcp/sse');
    expect(res.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('no longer accepts tokens via the query string (they leak into logs)', async () => {
    query.mockResolvedValue({ rows: [{ tenant_id: 'g', discord_id: 'u' }] });
    const res = await request(app).get('/api/mcp/sse?token=leaky-token');
    expect(res.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects tokens that do not exist (or are revoked)', async () => {
    query.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/api/mcp/sse')
      .set('Authorization', 'Bearer nope');
    expect(res.status).toBe(403);
  });

  it('filters out revoked tokens at the SQL layer', async () => {
    query.mockResolvedValue({ rows: [] });
    await request(app).get('/api/mcp/sse').set('Authorization', 'Bearer some-token');
    expect(query.mock.calls[0][0]).toContain('revoked_at IS NULL');
  });

  it('looks tokens up by SHA-256 hash, never by the raw value', async () => {
    query.mockResolvedValue({ rows: [] });
    const raw = 'raw-secret-token';
    await request(app).get('/api/mcp/sse').set('Authorization', `Bearer ${raw}`);
    const expectedHash = crypto.createHash('sha256').update(raw).digest('hex');
    expect(query.mock.calls[0][1]).toEqual([expectedHash]);
    expect(JSON.stringify(query.mock.calls[0][1])).not.toContain(raw);
  });

  it('returns 404 for /message posts with an unknown session id', async () => {
    const res = await request(app).post('/api/mcp/message?sessionId=forged-session');
    expect(res.status).toBe(404);
  });

  it('fails closed (500) when the token lookup errors', async () => {
    query.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/mcp/sse').set('Authorization', 'Bearer x');
    expect(res.status).toBe(500);
  });
});
