import { isBanned, addBan } from '../tenant/store.js';

export async function enforceBan(tenantCtx, actor) {
  if (!actor) return false;
  const userKey =
    actor.kind === 'discord' ? `discord:${actor.id || actor.member?.id}` :
    actor.kind === 'in_game' ? `ingame:${actor.playerName}` :
    actor.kind === 'api' ? `api:${actor.tokenId}` :
    null;
  if (!userKey) return false;
  return await isBanned(tenantCtx.tenantId, userKey);
}

export async function recordBan({ tenantId, userKey, reason, bannedBy }) {
  await addBan({ tenantId, userKey, reason, bannedBy });
}
