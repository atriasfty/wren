import {
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import {
  resolveTenantByGuildId,
  resolveTenantById,
  setEncryptionKey,
  invalidateTenant,
} from '../tenant/resolve.js';
import {
  createTenant,
  getTenant,
  listSources,
  addSource,
  removeSource,
  setSourceEnabled,
  getPolicy,
  setPolicyEntry,
  getRoleSlots,
  setRoleSlot,
  listBans,
  addBan,
  removeBan,
  listMemory,
  removeMemory,
  getDefaultPolicy,
  updateTenant,
  setTenantSecret,
  pruneExpiredEvents,
} from '../tenant/store.js';
import { loadConfig } from '../config.js';
import { ingestTenant } from '../rag/ingest.js';
import { appendManualDoc } from '../rag/store.js';
import { SETTABLE_KEYS } from './validation.js';


function deny() {
  return { ok: false, error: 'You need ManageGuild permission for this.' };
}

function checkManageGuild(interaction) {
  return interaction.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild) ?? false;
}

function isOwner(interaction) {
  return interaction.guild?.ownerId === interaction.user.id;
}

function ephemeral(text) {
  return { content: text, ephemeral: true };
}

async function loadCtx(interaction) {
  const cfg = loadConfig();
  setEncryptionKey(cfg.tenantSecretEncKey);
  const ctx = await resolveTenantByGuildId(interaction.guild.id);
  return { ctx, cfg };
}

function publicResponse(text) {
  return { content: text, ephemeral: false };
}

export async function handleSetup(interaction) {
  if (!checkManageGuild(interaction)) return ephemeral(deny().error);
  const { ctx } = await loadCtx(interaction);
  if (ctx) return ephemeral('This server is already configured as a tenant.');

  const cfg = loadConfig();
  await createTenant({
    tenantId: interaction.guild.id,
    displayName: interaction.guild.name,
    ownerDiscordId: interaction.guild.ownerId,
    encKey: cfg.tenantSecretEncKey,
  });
  await pruneExpiredEvents();
  return ephemeral(`Setup complete. Tenant row created for **${interaction.guild.name}**.`);
}

export async function handleConfig(interaction) {
  if (!checkManageGuild(interaction)) return ephemeral(deny().error);
  const sub = interaction.options.getSubcommand();
  const { ctx } = await loadCtx(interaction);
  if (!ctx) return ephemeral('Run `/wren setup` first.');

  if (sub === 'view') {
    const t = ctx.tenant;
    const lines = [
      `**Display name:** ${t.displayName}`,
      `**Bot display name:** ${t.botDisplayName}`,
      `**In-game handle:** ${t.inGameHandle}`,
      `**Status channel:** ${t.statusChannelId || '—'}`,
      `**ERLC log channel:** ${t.erlcLogChannelId || '—'}`,
      `**Ticket category:** ${t.ticketCategoryId || '—'}`,
      `**Security role:** ${t.securityRoleId || '—'}`,
      `**Raid alert channel:** ${t.raidAlertChannel || '—'}`,
      `**Raid alert role:** ${t.raidAlertRole || '—'}`,
      `**Raid auto-punish:** ${t.raidAutoPunish ? 'on' : 'off'}`,
      `**Core info:** ${t.coreInfo ? `${t.coreInfo.slice(0, 200)}${t.coreInfo.length > 200 ? '…' : ''}` : '—'}`,
    ];
    return ephemeral(lines.join('\n'));
  }

  if (sub === 'set') {
    const key = interaction.options.getString('key');
    const value = interaction.options.getString('value');
    if (!SETTABLE_KEYS.has(key)) return ephemeral(`Unknown or non-settable key: \`${key}\`. Allowed: ${[...SETTABLE_KEYS].join(', ')}`);
    const patch = { [camelToSnake(key)]: value };
    await updateTenant(interaction.guild.id, patch, loadConfig().tenantSecretEncKey);
    return ephemeral(`Set \`${key}\` = \`${value}\``);
  }

  if (sub === 'core-info') return setSimpleField(interaction, 'coreInfo');
  if (sub === 'response-style') return setSimpleField(interaction, 'responseStyle');
  if (sub === 'bot-name') return setSimpleField(interaction, 'botDisplayName');
  if (sub === 'in-game-handle') return setSimpleField(interaction, 'inGameHandle');
  if (sub === 'raid-auto-punish') return setSimpleBool(interaction, 'raidAutoPunish');
  if (sub === 'status-channel') return setSimpleField(interaction, 'statusChannelId', 'channel');
  if (sub === 'erlc-log-channel') return setSimpleField(interaction, 'erlcLogChannelId', 'channel');
  if (sub === 'ticket-category') return setSimpleField(interaction, 'ticketCategoryId', 'channel');
  if (sub === 'security-role') return setSimpleField(interaction, 'securityRoleId', 'role');
  if (sub === 'raid-alert') {
    const channel = interaction.options.getChannel('channel');
    const role = interaction.options.getRole('role');
    const patch = { raidAlertChannel: channel.id };
    if (role) patch.raidAlertRole = role.id;
    await updateTenant(interaction.guild.id, patch, loadConfig().tenantSecretEncKey);
    return ephemeral(`Raid alert channel set to <#${channel.id}>${role ? `, role <@&${role.id}>` : ''}.`);
  }

  return ephemeral(`Unknown subcommand: ${sub}`);
}

function camelToSnake(s) {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

async function setSimpleField(interaction, dbField, kind = 'string') {
  let value;
  if (kind === 'channel') value = interaction.options.getChannel('channel')?.id;
  else if (kind === 'role') value = interaction.options.getRole('role')?.id;
  else value = interaction.options.getString('text') ?? interaction.options.getString('name') ?? interaction.options.getString('handle');
  if (!value) return ephemeral('Missing value.');
  await updateTenant(interaction.guild.id, { [dbField]: value }, loadConfig().tenantSecretEncKey);
  return ephemeral(`Saved.`);
}

async function setSimpleBool(interaction, dbField) {
  const v = interaction.options.getBoolean('enabled');
  await updateTenant(interaction.guild.id, { [dbField]: v }, loadConfig().tenantSecretEncKey);
  return ephemeral(`${dbField} = ${v}`);
}

export async function handleSources(interaction) {
  if (!checkManageGuild(interaction)) return ephemeral(deny().error);
  const sub = interaction.options.getSubcommand();
  const tenantId = interaction.guild.id;
  const { ctx } = await loadCtx(interaction);
  if (!ctx) return ephemeral('Run `/wren setup` first.');

  if (sub === 'list') {
    const rows = await listSources(tenantId);
    if (!rows.length) return ephemeral('No sources configured.');
    const lines = rows.map((r) => `${r.enabled ? '✅' : '⛔'} \`${r.kind}\` ${r.ref}${r.label ? ` — ${r.label}` : ''} (w=${r.weight})`);
    return ephemeral(lines.join('\n'));
  }

  if (sub === 'add') {
    const kind = interaction.options.getString('kind');
    const ref = interaction.options.getString('ref');
    const label = interaction.options.getString('label') || null;
    const weight = interaction.options.getNumber('weight') ?? 1.0;
    await addSource({ tenantId, kind, ref, label, weight });
    return ephemeral(`Added source: \`${kind}\` ${ref}`);
  }

  if (sub === 'remove') {
    const kind = interaction.options.getString('kind');
    const ref = interaction.options.getString('ref');
    await removeSource({ tenantId, kind, ref });
    return ephemeral(`Removed source: \`${kind}\` ${ref}`);
  }

  if (sub === 'toggle') {
    const kind = interaction.options.getString('kind');
    const ref = interaction.options.getString('ref');
    const enabled = interaction.options.getBoolean('enabled');
    await setSourceEnabled({ tenantId, kind, ref, enabled });
    return ephemeral(`${enabled ? 'Enabled' : 'Disabled'} \`${kind}\` ${ref}.`);
  }

  return ephemeral(`Unknown subcommand: ${sub}`);
}

export async function handlePolicy(interaction) {
  if (!checkManageGuild(interaction)) return ephemeral(deny().error);
  const sub = interaction.options.getSubcommand();
  const tenantId = interaction.guild.id;

  if (sub === 'view') {
    const policy = await getPolicy(tenantId);
    const lines = Object.entries(policy).sort().map(([k, v]) => `\`${k}\` → ${v}`);
    return ephemeral(lines.length ? lines.join('\n') : '(no policy rows)');
  }

  if (sub === 'set') {
    const tool = interaction.options.getString('tool');
    const minRole = interaction.options.getString('min-role');
    await setPolicyEntry({ tenantId, tool, minRole });
    return ephemeral(`Set \`${tool}\` → ${minRole}`);
  }

  return ephemeral(`Unknown subcommand: ${sub}`);
}

export async function handleRoles(interaction) {
  if (!checkManageGuild(interaction)) return ephemeral(deny().error);
  const sub = interaction.options.getSubcommand();
  const tenantId = interaction.guild.id;

  if (sub === 'view') {
    const slots = await getRoleSlots(tenantId);
    if (!Object.keys(slots).length) return ephemeral('No role slots configured.');
    return ephemeral(Object.entries(slots).map(([k, v]) => `\`${k}\` → <@&${v}>`).join('\n'));
  }

  if (sub === 'set') {
    const slot = interaction.options.getString('slot');
    const role = interaction.options.getRole('role');
    await setRoleSlot({ tenantId, slot, roleId: role.id });
    return ephemeral(`Set \`${slot}\` → <@&${role.id}>`);
  }

  return ephemeral(`Unknown subcommand: ${sub}`);
}

export async function handleBans(interaction) {
  if (!checkManageGuild(interaction)) return ephemeral(deny().error);
  const sub = interaction.options.getSubcommand();
  const tenantId = interaction.guild.id;

  if (sub === 'list') {
    const rows = await listBans(tenantId);
    if (!rows.length) return ephemeral('No bans.');
    return ephemeral(rows.map((b) => `• \`${b.userKey}\` — ${b.reason || '(no reason)'} (by ${b.bannedBy || '?'})`).join('\n'));
  }

  if (sub === 'add') {
    const target = interaction.options.getUser('target');
    const reason = interaction.options.getString('reason') || null;
    const userKey = `discord:${target.id}`;
    await addBan({ tenantId, userKey, reason, bannedBy: `discord:${interaction.user.id}` });
    return ephemeral(`Banned \`${userKey}\`${reason ? ` — ${reason}` : ''}.`);
  }

  if (sub === 'remove') {
    const target = interaction.options.getUser('target');
    const userKey = `discord:${target.id}`;
    await removeBan({ tenantId, userKey });
    return ephemeral(`Unbanned \`${userKey}\`.`);
  }

  return ephemeral(`Unknown subcommand: ${sub}`);
}

export async function handleMemory(interaction) {
  if (!checkManageGuild(interaction)) return ephemeral(deny().error);
  const sub = interaction.options.getSubcommand();
  const tenantId = interaction.guild.id;

  if (sub === 'list') {
    const rows = await listMemory(tenantId);
    if (!rows.length) return ephemeral('No memory.');
    return ephemeral(rows.slice(0, 25).map((m) => `[#${m.id} ${m.scope}${m.userKey ? ` /${m.userKey}` : ''}] ${m.content}`).join('\n'));
  }

  if (sub === 'add') {
    const scope = interaction.options.getString('scope');
    const content = interaction.options.getString('content');
    if (scope === 'server' && !isOwner(interaction)) return ephemeral('Only the server owner can add server-scoped memory.');
    const userKey = scope === 'user' ? `discord:${interaction.user.id}` : null;
    const { addMemory } = await import('../tenant/store.js');
    await addMemory({ tenantId, scope, userKey, content, addedBy: `discord:${interaction.user.id}` });
    return ephemeral(`Saved ${scope} memory.`);
  }

  if (sub === 'remove') {
    const id = interaction.options.getInteger('id');
    await removeMemory(tenantId, id);
    return ephemeral(`Removed memory #${id}.`);
  }

  return ephemeral(`Unknown subcommand: ${sub}`);
}

export async function handleIngest(interaction) {
  if (!isOwner(interaction)) return ephemeral('Only the server owner can run ingestion.');
  const sub = interaction.options.getSubcommand();
  const { ctx } = await loadCtx(interaction);
  if (!ctx) return ephemeral('Run `/wren setup` first.');

  if (sub === 'run') {
    const kind = interaction.options.getString('kind') || 'all';
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await ingestTenant(ctx, interaction.client, { kinds: [kind] });
      await interaction.editReply(`Ingestion done. ${result.chunks} chunks from ${result.sources ?? 0} sources.`);
    } catch (err) {
      await interaction.editReply(`Ingestion failed: ${err.message}`);
    }
    return null;
  }

  if (sub === 'status') {
    const sources = await listSources(interaction.guild.id);
    const lines = sources.map((s) => `${s.lastIngestedAt ? '✅' : '⏳'} \`${s.kind}\` ${s.ref}${s.lastIngestedAt ? ` (last: ${s.lastIngestedAt.toISOString?.() ?? s.lastIngestedAt})` : ''}`);
    return ephemeral(lines.length ? lines.join('\n') : 'No sources configured.');
  }

  return ephemeral(`Unknown subcommand: ${sub}`);
}

export async function dispatchGarminCommand(interaction) {
  const group = interaction.options.getSubcommandGroup();
  const sub = interaction.options.getSubcommand();

  // Read-only commands: don't invalidate. Anything that mutates should appear in this set
  // so the in-process tenant cache is dropped and the next message reflects the change.
  const readOnly = new Set([
    'config:view', 'policy:view', 'roles:view', 'sources:list',
    'bans:list', 'memory:list', 'ingest:status',
  ]);
  const key = `${group ?? ''}:${sub ?? ''}`;

  let reply;
  if (group === null) {
    if (sub === 'setup') reply = await handleSetup(interaction);
    else reply = ephemeral('Unknown command.');
  } else {
    switch (group) {
      case 'config': reply = await handleConfig(interaction); break;
      case 'sources': reply = await handleSources(interaction); break;
      case 'policy': reply = await handlePolicy(interaction); break;
      case 'roles': reply = await handleRoles(interaction); break;
      case 'bans': reply = await handleBans(interaction); break;
      case 'memory': reply = await handleMemory(interaction); break;
      case 'ingest': reply = await handleIngest(interaction); break;
      default: reply = ephemeral(`Unknown group: ${group}`);
    }
  }

  if (!readOnly.has(key) && interaction.guild?.id) {
    invalidateTenant(interaction.guild.id);
  }
  return reply;
}
