import { getTenant, getPolicy, getRoleSlots, listSources, listMemory } from './store.js';

export async function buildTenantContext(tenantId, encKey) {
  const tenant = await getTenant(tenantId, encKey);
  if (!tenant) return null;
  const [policy, roleSlots, sources, memory] = await Promise.all([
    getPolicy(tenantId),
    getRoleSlots(tenantId),
    listSources(tenantId, { enabledOnly: true }),
    listMemory(tenantId, { limit: 200 }),
  ]);
  return {
    tenantId,
    tenant,
    policy,
    roleSlots,
    sources,
    memory,
    dataDir: `data/tenants/${tenantId}`,
    vectorStorePath: `data/tenants/${tenantId}/vector-store.json`,
  };
}