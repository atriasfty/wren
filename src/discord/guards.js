import { addBan, isBanned } from '../tenant/store.js';

export async function enforceBan(tenantCtx, actor) {
  if (!actor) return false;
  const userKey =
    actor.kind === 'discord' ? `discord:${actor.id || actor.member?.id}` :
    actor.kind === 'in_game' ? `ingame:${actor.playerName}` :
    actor.kind === 'api' ? `api:${actor.tokenId}` :
    null;
  if (!userKey) return false;

  // ⚡ Bolt: Fast-path O(1) memory check using the cached bans Set on the tenant context
  // Falls back to a database lookup only if the cache isn't present
  if (tenantCtx?.bans instanceof Set) {
    return tenantCtx.bans.has(userKey);
  }
  return isBanned(tenantCtx.tenantId, userKey);
}

export async function recordBan({ tenantId, userKey, reason, bannedBy }) {
  await addBan({ tenantId, userKey, reason, bannedBy });
}
