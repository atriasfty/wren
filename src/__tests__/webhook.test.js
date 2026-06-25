import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
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
}));

vi.mock('../tenant/resolve.js', () => ({
  resolveTenantById: vi.fn(),
  setEncryptionKey: vi.fn(),
}));

vi.mock('../config.js', () => ({
  loadConfig: () => ({ tenantSecretEncKey: Buffer.alloc(32) }),
}));

describe('Polar Webhook', () => {
  it('should process a valid subscription.created event', async () => {
    process.env.POLAR_WEBHOOK_SECRET = 'test-secret';
    process.env.POLAR_CORE_PRODUCT_ID = 'prod_core';
    
    // Mock the SDK validation to return a parsed event
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
      .send({ some: 'data' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Should have updated the database
    expect(store.updateSubscription).toHaveBeenCalledWith(
      'guild_1', 'core', 'sub_123', 'user_1', 'cus_456'
    );
  });
});
