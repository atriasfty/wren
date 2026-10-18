import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { validateEvent } from '@polar-sh/sdk/webhooks';
import * as store from '../tenant/store.js';
import * as resolve from '../tenant/resolve.js';
import { createApiServer } from '../api/server.js';

vi.mock('@polar-sh/sdk/webhooks', () => ({
  validateEvent: vi.fn(),
}));

vi.mock('../tenant/store.js', () => ({
  updateSubscription: vi.fn(),
  findTenantByTokenHash: vi.fn(),
  tryClaimEvent: vi.fn(),
  releaseEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../tenant/resolve.js', () => ({
  resolveTenantById: vi.fn(),
  setEncryptionKey: vi.fn(),
  invalidateTenant: vi.fn(),
}));

vi.mock('../config.js', () => ({
  loadConfig: () => ({ tenantSecretEncKey: Buffer.alloc(32) }),
}));

describe('Polar Webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.tryClaimEvent.mockResolvedValue(true);
    process.env.POLAR_WEBHOOK_SECRET = 'test-secret';
    process.env.POLAR_CORE_PRODUCT_ID = 'prod_core';
  });

  it('should process a valid subscription.created event', async () => {
    validateEvent.mockReturnValue({
      type: 'subscription.created',
      data: {
        id: 'sub_123',
        customer_id: 'cus_456',
        product_id: 'prod_core',
        metadata: {
          tenantId: 'guild_1',
          ownerId: 'user_1'
        }
      }
    });

    resolve.resolveTenantById.mockResolvedValue(null); // No existing sub conflict

    const clientMock = {
      guilds: {
        fetch: vi.fn().mockResolvedValue(null) // Mock missing guild, shouldn't crash
      }
    };

    const app = await createApiServer(clientMock);

    const res = await request(app)
      .post('/webhooks/polar')
      .set('webhook-signature', 't=123,v1=abc')
      .set('webhook-id', 'msg_1')
      .send({ some: 'data' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Should have updated the database
    expect(store.updateSubscription).toHaveBeenCalledWith(
      'guild_1', 'core', 'sub_123', 'user_1', 'cus_456'
    );

    // The 60s tenant cache must be invalidated right after the write, or a
    // second webhook for the same tenant arriving inside that window would
    // read stale pre-write data back out of resolveTenantById.
    expect(resolve.invalidateTenant).toHaveBeenCalledWith('guild_1');
  });

  it('should skip reprocessing a redelivered webhook (same webhook-id)', async () => {
    validateEvent.mockReturnValue({
      type: 'subscription.created',
      data: {
        id: 'sub_123',
        customer_id: 'cus_456',
        product_id: 'prod_core',
        metadata: { tenantId: 'guild_1', ownerId: 'user_1' },
      },
    });
    store.tryClaimEvent.mockResolvedValue(false); // already claimed by a prior delivery

    const app = await createApiServer({ guilds: { fetch: vi.fn() } });

    const res = await request(app)
      .post('/webhooks/polar')
      .set('webhook-signature', 't=123,v1=abc')
      .set('webhook-id', 'msg_1')
      .send({ some: 'data' });

    expect(res.status).toBe(200);
    expect(res.body.note).toMatch(/duplicate/i);
    expect(store.updateSubscription).not.toHaveBeenCalled();
    expect(resolve.invalidateTenant).not.toHaveBeenCalled();
  });

  it('invalidates the tenant cache after a cancellation downgrade', async () => {
    validateEvent.mockReturnValue({
      type: 'subscription.canceled',
      data: {
        id: 'sub_123',
        metadata: { tenantId: 'guild_1' },
      },
    });
    resolve.resolveTenantById.mockResolvedValue({
      tenant: { polarSubscriptionId: 'sub_123' },
    });

    const app = await createApiServer({ guilds: { fetch: vi.fn() } });

    const res = await request(app)
      .post('/webhooks/polar')
      .set('webhook-signature', 't=123,v1=abc')
      .set('webhook-id', 'msg_2')
      .send({ some: 'data' });

    expect(res.status).toBe(200);
    expect(store.updateSubscription).toHaveBeenCalledWith('guild_1', 'free', null, null, null);
    expect(resolve.invalidateTenant).toHaveBeenCalledWith('guild_1');
  });

  it('reads the camelCase fields validateEvent() actually returns', async () => {
    validateEvent.mockReturnValue({
      type: 'subscription.created',
      data: {
        id: 'sub_cc',
        customerId: 'cus_cc',
        productId: 'prod_core',
        metadata: { tenantId: 'guild_1', ownerId: 'user_1' },
      },
    });
    resolve.resolveTenantById.mockResolvedValue(null);
    const app = await createApiServer({ guilds: { fetch: vi.fn().mockResolvedValue(null) } });

    const res = await request(app).post('/webhooks/polar').set('webhook-id', 'msg_cc').send({});

    expect(res.status).toBe(200);
    expect(store.updateSubscription).toHaveBeenCalledWith('guild_1', 'core', 'sub_cc', 'user_1', 'cus_cc');
  });

  it('releases the delivery claim when processing fails, so the retry is not dropped', async () => {
    validateEvent.mockReturnValue({
      type: 'subscription.created',
      data: { id: 'sub_x', productId: 'prod_core', metadata: { tenantId: 'guild_1', ownerId: 'u' } },
    });
    resolve.resolveTenantById.mockRejectedValue(new Error('db down'));
    const app = await createApiServer({ guilds: { fetch: vi.fn() } });

    const res = await request(app).post('/webhooks/polar').set('webhook-id', 'msg_fail').send({});

    expect(res.status).toBe(500);
    expect(store.releaseEvent).toHaveBeenCalledWith({ tenantId: 'guild_1', eventId: 'msg_fail' });
    expect(store.updateSubscription).not.toHaveBeenCalled();
  });

  it('ignores an update for an already-cancelled, non-active subscription', async () => {
    validateEvent.mockReturnValue({
      type: 'subscription.updated',
      data: { id: 'sub_old', productId: 'prod_core', cancelAtPeriodEnd: true, status: 'active', metadata: { tenantId: 'guild_1', ownerId: 'u1' } },
    });
    resolve.resolveTenantById.mockResolvedValue({ tenant: { polarSubscriptionId: 'sub_new', subscriptionTier: 'core', subscriptionOwnerId: 'u2' } });
    const app = await createApiServer({ guilds: { fetch: vi.fn() } });

    const res = await request(app).post('/webhooks/polar').set('webhook-id', 'msg_old').send({});

    expect(res.status).toBe(200);
    expect(res.body.note).toMatch(/non-active/);
    expect(store.updateSubscription).not.toHaveBeenCalled();
  });
});
