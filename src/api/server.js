import express from 'express';
import { hashToken } from '../tenant/crypto.js';
import { findTenantByTokenHash, pruneExpiredEvents } from '../tenant/store.js';
import { resolveTenantById, setEncryptionKey } from '../tenant/resolve.js';
import { runAssistantPipeline } from '../ai/pipeline.js';
import { loadConfig } from '../config.js';

const SCOPES = new Set(['chat', 'mod']);

export async function createApiServer() {
  const cfg = loadConfig();
  setEncryptionKey(cfg.tenantSecretEncKey);

  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.use((req, res, next) => {
    res.setHeader('X-Powered-By', 'wren');
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  async function auth(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });
    const tokenHash = hashToken(token);
    const row = await findTenantByTokenHash(tokenHash);
    if (!row) return res.status(401).json({ error: 'Invalid token' });
    if (!row.scopes?.some((s) => SCOPES.has(s))) return res.status(403).json({ error: 'Token lacks required scope' });
    const ctx = await resolveTenantById(row.tenantId);
    if (!ctx) return res.status(404).json({ error: 'Tenant not found' });
    req.tenantCtx = ctx;
    req.actor = { kind: 'api', tokenId: row.tokenHash.slice(0, 8), scopes: row.scopes };
    next();
  }

  function requireScope(scope) {
    return (req, res, next) => {
      if (!req.actor?.scopes?.includes(scope)) {
        return res.status(403).json({ error: `Scope '${scope}' required` });
      }
      next();
    };
  }

  app.post('/v1/chat', auth, requireScope('chat'), async (req, res) => {
    const { question, channelContext = null, imageUrls = [] } = req.body || {};
    if (!question || typeof question !== 'string') return res.status(400).json({ error: 'question required' });
    try {
      const result = await runAssistantPipeline(req.tenantCtx, {
        question,
        channelContext,
        imageUrls,
        actor: req.actor,
      });
      res.json({ text: result.text, error: result.error || null });
    } catch (err) {
      console.error('[api] chat failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/v1/info', auth, requireScope('chat'), async (req, res) => {
    const t = req.tenantCtx.tenant;
    res.json({
      tenantId: t.tenantId,
      displayName: t.displayName,
      botDisplayName: t.botDisplayName,
      sourcesCount: req.tenantCtx.sources.length,
      policyCount: Object.keys(req.tenantCtx.policy).length,
    });
  });

  setInterval(() => pruneExpiredEvents().catch(() => {}), 60 * 60 * 1000);

  return app;
}

export async function startApiServer() {
  const app = await createApiServer();
  const cfg = loadConfig();
  const port = cfg.apiPort || 42011;
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`[api] listening on :${port}`);
      resolve(server);
    });
  });
}
