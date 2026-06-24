import { buildTenantContext } from './ctx.js';

const TTL_MS = 60_000;
const cache = new Map();
let encKey = null;

export function setEncryptionKey(key) {
  encKey = key;
  cache.clear();
}

export async function resolveTenantByGuildId(guildId) {
  if (!guildId) return null;
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.ctx;
  const ctx = await buildTenantContext(guildId, encKey);
  if (ctx) cache.set(guildId, { ctx, expiresAt: Date.now() + TTL_MS });
  return ctx;
}

export async function resolveTenantById(tenantId) {
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.ctx;
  const ctx = await buildTenantContext(tenantId, encKey);
  if (ctx) cache.set(tenantId, { ctx, expiresAt: Date.now() + TTL_MS });
  return ctx;
}

export function invalidateTenant(tenantId) {
  cache.delete(tenantId);
}

export function clearCache() {
  cache.clear();
}