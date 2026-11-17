import { getTenant, getPolicy, getRoleSlots, listSources, listMemory, listBans } from './store.js';

export async function buildTenantContext(tenantId, encKey) {
  const tenant = await getTenant(tenantId, encKey);
  if (!tenant) return null;
  const [policy, roleSlots, sources, memory, bans] = await Promise.all([
    getPolicy(tenantId),
    getRoleSlots(tenantId),
    listSources(tenantId, { enabledOnly: true }),
    listMemory(tenantId, { limit: 200 }),
    listBans(tenantId),
  ]);
  return {
    tenantId,
    tenant,
    policy,
    roleSlots,
    sources,
    memory,
    // ⚡ Bolt: Cache bans in memory as a Set for O(1) synchronous lookups in enforceBan
    // This eliminates an O(N) database query on the hot path for every incoming message.
    bans: new Set(bans.map(b => b.user_key)),
    dataDir: `data/tenants/${tenantId}`,
    vectorStorePath: `data/tenants/${tenantId}/vector-store.json`,
  };
}