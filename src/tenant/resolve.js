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

// tenantId === guildId for all tenants - delegate to shared cache.
export async function resolveTenantById(tenantId) {
  return resolveTenantByGuildId(tenantId);
}

export function invalidateTenant(tenantId) {
  cache.delete(tenantId);
}

export function clearCache() {
  cache.clear();
}