import express from 'express';
import { hashToken } from '../tenant/crypto.js';
import { findTenantByTokenHash, updateSubscription } from '../tenant/store.js';
import { resolveTenantById, setEncryptionKey } from '../tenant/resolve.js';
import { validateEvent } from '@polar-sh/sdk/webhooks';
import { runAssistantPipeline } from '../ai/pipeline.js';
import { loadConfig } from '../config.js';
import { createMcpRouter } from './mcp.js';

const SCOPES = new Set(['chat', 'mod']);

// Simple in-memory rate limiter: 20 requests per token per 60 s window.
const rateLimitMap = new Map();

function pruneExpiredRateLimits(now = Date.now()) {
  for (const [key, entry] of rateLimitMap.entries()) {
    if (!entry || now > entry.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}

function checkRateLimit(tokenHash, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  pruneExpiredRateLimits(now);
  let entry = rateLimitMap.get(tokenHash);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  if (entry.count >= limit) {
    rateLimitMap.set(tokenHash, entry);
    return false;
  }
  entry.count++;
  rateLimitMap.set(tokenHash, entry);
  return true;
}

export async function createApiServer(client) {
  const cfg = loadConfig();
  setEncryptionKey(cfg.tenantSecretEncKey);

  const app = express();
  app.use(express.json({ 
    limit: '256kb',
    verify: (req, res, buf) => { req.rawBody = buf; }
  }));

  app.use((req, res, next) => {
    res.setHeader('X-Powered-By', 'wren');
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/mcp', createMcpRouter(client));

  app.post('/webhooks/polar', async (req, res) => {
    try {
      const webhookSecret = process.env.POLAR_WEBHOOK_SECRET;
      if (!webhookSecret) return res.status(500).json({ error: 'Webhook secret not configured' });
      
      const payload = validateEvent(
        req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body),
        req.headers,
        webhookSecret
      );

      const event = payload;
      if (event.type === 'subscription.created' || event.type === 'subscription.updated') {
        const sub = event.data;
        const tenantId = sub.metadata?.tenantId;
        const ownerId = sub.metadata?.ownerId;
        const customerId = sub.customer_id;
        const productId = sub.product_id;
        let tier = 'free';
        if (productId === process.env.POLAR_CORE_PRODUCT_ID) tier = 'core';
        else if (productId === process.env.POLAR_PRO_PRODUCT_ID) tier = 'pro';
        
        if (tenantId) {
          const { resolveTenantById } = await import('../tenant/resolve.js');
          const ctx = await resolveTenantById(tenantId);
          
          if (ctx) {
            const oldSubId = ctx.tenant.polarSubscriptionId;
            const oldTier = ctx.tenant.subscriptionTier || 'free';
            const oldOwnerId = ctx.tenant.subscriptionOwnerId;

            if (oldSubId && oldSubId !== sub.id && oldTier !== 'free') {
              const tierValue = { free: 0, core: 1, pro: 2 };
              const oldVal = tierValue[oldTier] || 0;
              const newVal = tierValue[tier] || 0;

              let subToCancel = null;
              let userToDm = null;
              let cancelledTier = null;
              let isReplaced = true;

              if (newVal < oldVal) {
                subToCancel = sub.id;
                userToDm = ownerId;
                cancelledTier = tier;
                isReplaced = false;
              } else {
                subToCancel = oldSubId;
                userToDm = oldOwnerId;
                cancelledTier = oldTier;
                isReplaced = true;
              }

              if (subToCancel) {
                try {
                  const { Polar } = await import('@polar-sh/sdk');
                  const polar = new Polar({ accessToken: process.env.POLAR_ACCESS_TOKEN || '' });
                  await polar.subscriptions.update({
                    id: subToCancel,
                    subscriptionUpdate: { cancelAtPeriodEnd: true }
                  });
                  
                  if (userToDm && client) {
                    const user = await client.users.fetch(userToDm).catch(() => null);
                    if (user) {
                      await user.send(`⚠️ Your Wren **${cancelledTier.toUpperCase()}** subscription for server \`${ctx.tenant.displayName}\` was automatically cancelled because someone else purchased a higher or equivalent tier subscription. You retain access until the end of the billing period.`);
                    }
                  }
                } catch (err) {
                  console.error('[webhook] failed to cancel double sub:', err.message);
                }
              }

              if (!isReplaced) {
                return res.json({ ok: true, note: 'ignored lower tier' });
              }
            }
          }

          await updateSubscription(tenantId, tier, sub.id, ownerId, customerId);
          // Try to send a success message to the guild
          if (client) {
            try {
              const guild = await client.guilds.fetch(tenantId).catch(() => null);
              if (guild) {
                let targetChannel = null;
                if (ctx?.tenant?.statusChannelId) {
                  targetChannel = await guild.channels.fetch(ctx.tenant.statusChannelId).catch(() => null);
                }
                if (!targetChannel) {
                  const channels = await guild.channels.fetch();
                  targetChannel = channels.find(c => c.isTextBased() && c.permissionsFor(guild.members.me).has('SendMessages'));
                }
                if (targetChannel) {
                  await targetChannel.send(`🎉 **Success!** This server has just been upgraded to the **${tier.toUpperCase()}** plan!\nYour new message limits are now active. Thanks for supporting Wren!`);
                }
              }
            } catch (err) {
              console.error('[webhook] failed to send upgrade message:', err.message);
            }
          }
        }
      } else if (event.type === 'subscription.canceled') {
        const sub = event.data;
        const tenantId = sub.metadata?.tenantId;
        if (tenantId) {
          const { resolveTenantById } = await import('../tenant/resolve.js');
          const ctx = await resolveTenantById(tenantId);
          // Only downgrade to free if the canceled sub is the currently active one
          if (ctx && ctx.tenant.polarSubscriptionId === sub.id) {
            await updateSubscription(tenantId, 'free', null, null, null);
          }
        }
      }
      
      res.json({ ok: true });
    } catch (err) {
      console.error('[webhook] polar validation failed:', err.message);
      res.status(400).json({ error: 'Webhook validation failed' });
    }
  });

  async function auth(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });
    const tokenHash = hashToken(token);
    const row = await findTenantByTokenHash(tokenHash);
    if (!row) return res.status(401).json({ error: 'Invalid token' });
    if (!row.scopes?.some((s) => SCOPES.has(s))) return res.status(403).json({ error: 'Token lacks required scope' });
    if (!checkRateLimit(tokenHash)) return res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });
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
    if (question.length > 4000) return res.status(400).json({ error: 'question too long (max 4000 chars)' });
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
      res.status(500).json({ error: 'Internal server error' });
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

  return app;
}

export async function startApiServer(client) {
  const app = await createApiServer(client);
  const cfg = loadConfig();
  const port = cfg.apiPort || 4167;
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`[api] listening on :${port}`);
      resolve(server);
    });
  });
}
