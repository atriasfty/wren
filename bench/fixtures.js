// Fake tenant + actors that satisfy the real buildSystemPrompt() and the real
// role policy (resolveActorRank / denialReason), with no DB or Discord.
import { getDefaultPolicy } from '../src/tenant/store.js';

export const GUILD_ID = '900000000000000001';
export const OWNER_ID = '800000000000000001';
export const CHANNEL_ID = '700000000000000001';

const ROLES = {
  leadership: { id: '600000000000000003', position: 30 },
  admin: { id: '600000000000000002', position: 20 },
  mod: { id: '600000000000000001', position: 10 },
};

export function makeTenantCtx({ memory = [], sources = [], responseStyle = null, coreInfo = null } = {}) {
  return {
    tenantId: GUILD_ID,
    tenant: {
      botDisplayName: 'Wren',
      displayName: 'Liberty County Roleplay',
      coreInfo: coreInfo ?? 'ERLC roleplay server. Peak hours are 6pm to 11pm EST. Staff ranks: Moderator, Administrator, Leadership.',
      responseStyle,
      subscriptionTier: 'pro',
      leadershipRoleId: ROLES.leadership.id,
      adminRoleId: ROLES.admin.id,
      modRoleId: ROLES.mod.id,
    },
    policy: getDefaultPolicy(),
    roleSlots: {},
    sources,
    memory: memory.map((m, i) => ({ id: i + 1, scope: m.scope || 'server', user_key: m.user_key ?? null, content: m.content })),
  };
}

const guildRoles = new Map(Object.values(ROLES).map((r) => [r.id, r]));

// spec: { kind: 'discord', rank: 'user'|'mod'|'admin'|'leadership'|'owner', name }
//    or { kind: 'in_game', name, isStaff }
export function makeActor(spec = {}) {
  if (spec.kind === 'in_game') {
    return { kind: 'in_game', playerName: spec.name, isStaff: !!spec.isStaff };
  }
  const rank = spec.rank || 'user';
  const id = rank === 'owner' ? OWNER_ID : `5000000000000000${String(Object.keys(ROLES).indexOf(rank) + 2).padStart(2, '0')}`;
  const heldRoles = ROLES[rank] ? [ROLES[rank]] : [];
  const guild = { id: GUILD_ID, ownerId: OWNER_ID, roles: { cache: guildRoles } };
  return {
    kind: 'discord',
    member: {
      id,
      nickname: null,
      user: { id, username: spec.name || 'benchuser' },
      guild,
      permissions: { has: () => false },
      roles: { cache: heldRoles },
    },
  };
}

export function actorKeyFor(spec) {
  const a = makeActor(spec);
  return a.kind === 'in_game' ? `ingame:${a.playerName}` : `discord:${a.member.id}`;
}
