/**
 * Shared actor utilities used by both executor and pipeline.
 */
export function actorKey(actor) {
  if (!actor) return 'unknown';
  if (actor.kind === 'discord') return `discord:${actor.member?.id ?? '?'}`;
  if (actor.kind === 'in_game') return `ingame:${actor.playerName}`;
  if (actor.kind === 'api') return `api:${actor.tokenId ?? '?'}`;
  return 'unknown';
}
