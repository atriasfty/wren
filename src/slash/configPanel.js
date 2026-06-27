import {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} from 'discord.js';
import { resolveTenantByGuildId, invalidateTenant } from '../tenant/resolve.js';
import { updateTenant, setTenantSecret } from '../tenant/store.js';
import { loadConfig } from '../config.js';

// Field descriptors. `kind` controls what input the modal uses.
// `dbField` is the snake_case column on `tenants`. `label` is the embed label.
export const CONFIG_FIELDS = {
  // Identity
  displayName:    { dbField: 'display_name',    kind: 'text',     label: 'Server display name', category: 'Identity', placeholder: 'e.g. LA County Roleplay' },
  botDisplayName: { dbField: 'bot_display_name', kind: 'text',    label: 'Bot display name',    category: 'Identity', placeholder: 'e.g. Wren' },
  inGameHandle:   { dbField: 'in_game_handle',  kind: 'text',     label: 'In-game PM handle',   category: 'Identity', placeholder: 'e.g. :pm wren' },

  // Channels
  statusChannelId:    { dbField: 'status_channel_id',    kind: 'channel', label: 'Status channel',     category: 'Channels' },
  erlcLogChannelId:   { dbField: 'erlc_log_channel_id',  kind: 'channel', label: 'ERLC log channel',    category: 'Channels' },
  leadershipRoleId:   { dbField: 'leadership_role_id',   kind: 'role',    label: 'Leadership role',     category: 'Channels' },
  adminRoleId:        { dbField: 'admin_role_id',        kind: 'role',    label: 'Admin role',          category: 'Channels' },
  modRoleId:          { dbField: 'mod_role_id',          kind: 'role',    label: 'Mod role',            category: 'Channels' },

  // Behaviour
  coreInfo:      { dbField: 'core_info',      kind: 'longtext', label: 'Core info (always-on note)', category: 'Behaviour', placeholder: 'Server vibe, timezone, who to ping in an emergency…' },

  // Secrets
  erlcServerKey: { dbField: 'erlc_server_key_enc', kind: 'secret', label: 'ERLC server key', category: 'Secrets', placeholder: 'paste from the PRC dashboard' },
  powToken:      { dbField: 'pow_token_enc',       kind: 'secret', label: 'POW token',       category: 'Secrets', placeholder: 'paste your POW API token' },

  // Tickets
  ticketAutoresponderEnabled: { dbField: 'ticket_autoresponder_enabled', kind: 'boolean', label: 'Autoresponder On/Off', category: 'Tickets' },
  ticketCategoryId:           { dbField: 'ticket_category_id',           kind: 'channel_multi', label: 'Ticket Categories', category: 'Tickets', channelTypes: [ChannelType.GuildCategory] },
};

export const CONFIG_CATEGORIES = ['Identity', 'Channels', 'Behaviour', 'Secrets', 'Tickets'];

const SAFE = /^[\w\s.,:;'"!?()@&/\-+=#%]+$/;

function fieldValueFor(field, tenant) {
  const descriptor = CONFIG_FIELDS[field.key];
  switch (field.key) {
    case 'erlcServerKey': return tenant.erlcServerKey ? '•••••••• (set)' : '—';
    case 'powToken':      return tenant.powToken ? '•••••••• (set)' : '—';
    default:
      if (descriptor?.kind === 'boolean') return tenant[field.key] ? 'on' : 'off';
      if (descriptor?.kind === 'channel') return tenant[field.key] ? `<#${tenant[field.key]}>` : '—';
      if (descriptor?.kind === 'channel_multi') return tenant[field.key] ? tenant[field.key].split(',').map(id => `<#${id}>`).join(' ') : '—';
      if (descriptor?.kind === 'role') return tenant[field.key] ? `<@&${tenant[field.key]}>` : '—';
      return tenant[field.key] || '—';
  }
}

function embedValue(value, limit = 1000) {
  const text = String(value || '—');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export async function buildMainPanel(tenantId) {
  const ctx = await resolveTenantByGuildId(tenantId);
  if (!ctx) return null;
  const t = ctx.tenant;

  const embed = new EmbedBuilder()
    .setTitle(`Wren configuration — ${t.displayName}`)
    .setColor(0x0bb0d1)
    .setDescription('Pick a category below to view and edit your settings.')
    .addFields(
      { name: 'Identity',  value: `Display name: **${t.displayName}**\nBot name: **${t.botDisplayName}**\nIn-game handle: **${t.inGameHandle}**`, inline: false },
      { name: 'Channels',  value: `Status: ${t.statusChannelId ? `<#${t.statusChannelId}>` : '—'}\nERLC log: ${t.erlcLogChannelId ? `<#${t.erlcLogChannelId}>` : '—'}\nLeadership role: ${t.leadershipRoleId ? `<@&${t.leadershipRoleId}>` : '—'}\nAdmin role: ${t.adminRoleId ? `<@&${t.adminRoleId}>` : '—'}\nMod role: ${t.modRoleId ? `<@&${t.modRoleId}>` : '—'}`, inline: false },
      { name: 'Behaviour', value: `Core info: ${t.coreInfo ? `${t.coreInfo.slice(0, 100)}${t.coreInfo.length > 100 ? '…' : ''}` : '—'}`, inline: false },
      { name: 'Secrets',   value: `ERLC key: ${t.erlcServerKey ? '•••• set' : '—'}\nPOW token: ${t.powToken ? '•••• set' : '—'}`, inline: false },
      { name: 'Tickets',   value: `Autoresponder: ${t.ticketAutoresponderEnabled ? 'On' : 'Off'}\nCategories: ${t.ticketCategoryId ? t.ticketCategoryId.split(',').map(id => `<#${id}>`).join(' ') : '—'}`, inline: false },
    )
    .setFooter({ text: 'Wren · settings panel' });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`wren_cfg_cat:${tenantId}`)
    .setPlaceholder('Choose a category…')
    .addOptions(CONFIG_CATEGORIES.map((c) => ({ label: c, value: c })));

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select)],
  };
}

export async function buildCategoryPanel(tenantId, category) {
  const ctx = await resolveTenantByGuildId(tenantId);
  if (!ctx) return null;
  const t = ctx.tenant;

  const fields = Object.entries(CONFIG_FIELDS).filter(([, f]) => f.category === category);
  const embed = new EmbedBuilder()
    .setTitle(`${category} — ${t.displayName}`)
    .setColor(0x0bb0d1)
    .setDescription('Pick a setting below to edit it. Your changes save when you submit the form.')
    .addFields(fields.map(([key, f]) => ({
      name: f.label,
      value: embedValue(fieldValueFor({ key }, t)),
      inline: false,
    })));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`wren_cfg_field:${tenantId}`)
    .setPlaceholder(`Edit a ${category.toLowerCase()} setting…`)
    .addOptions(fields.map(([key, f]) => ({ label: f.label, value: key })));

  const back = new StringSelectMenuBuilder()
    .setCustomId(`wren_cfg_back:${tenantId}`)
    .setPlaceholder('← Back to categories')
    .addOptions([{ label: 'Back to categories', value: 'back' }]);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(back),
    ],
  };
}

export async function buildValueSelectPanel(tenantId, fieldKey) {
  const field = CONFIG_FIELDS[fieldKey];
  if (!field || !['channel', 'role', 'boolean'].includes(field.kind)) return null;

  const ctx = await resolveTenantByGuildId(tenantId);
  if (!ctx) return null;

  const embed = new EmbedBuilder()
    .setTitle(field.label)
    .setColor(0x0bb0d1)
    .setDescription('Pick a value below. The change saves immediately.');

  let picker;
  if (field.kind === 'channel' || field.kind === 'channel_multi') {
    picker = new ChannelSelectMenuBuilder()
      .setCustomId(`wren_cfg_value:${tenantId}:${fieldKey}`)
      .setPlaceholder(`Select ${field.label.toLowerCase()}…`)
      .setMinValues(1)
      .setMaxValues(field.kind === 'channel_multi' ? 10 : 1);
    if (field.channelTypes) picker.setChannelTypes(field.channelTypes);
  } else if (field.kind === 'role') {
    picker = new RoleSelectMenuBuilder()
      .setCustomId(`wren_cfg_value:${tenantId}:${fieldKey}`)
      .setPlaceholder(`Select ${field.label.toLowerCase()}…`)
      .setMinValues(1)
      .setMaxValues(1);
  } else {
    picker = new StringSelectMenuBuilder()
      .setCustomId(`wren_cfg_value:${tenantId}:${fieldKey}`)
      .setPlaceholder(`Set ${field.label.toLowerCase()}…`)
      .addOptions([
        { label: 'On', value: 'true' },
        { label: 'Off', value: 'false' },
      ]);
  }

  const back = new ButtonBuilder()
    .setCustomId(`wren_cfg_back:${tenantId}`)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(picker),
      new ActionRowBuilder().addComponents(back),
    ],
  };
}

export async function buildFieldModal(tenantId, fieldKey) {
  const field = CONFIG_FIELDS[fieldKey];
  if (!field) return null;

  const modal = new ModalBuilder()
    .setCustomId(`wren_cfg_modal:${tenantId}:${fieldKey}`)
    .setTitle(field.label);

  if (['channel', 'channel_multi', 'role', 'boolean'].includes(field.kind)) return null;

  const isLong = field.kind === 'longtext' || field.kind === 'secret';
  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(field.label)
    .setStyle(isLong ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(true);

  if (field.placeholder) input.setPlaceholder(field.placeholder);

  if (field.kind === 'secret') {
    // Sensible cap so a paste mistake doesn't blow up the column.
    input.setMaxLength(500);
  } else if (isLong) {
    input.setMaxLength(1800);
  }

  if (field.kind === 'text' && !isLong) input.setMaxLength(120);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function isSafeText(value) {
  if (typeof value !== 'string') return false;
  if (value.length > 1800) return false;
  return value.split('\n').every((line) => !line || SAFE.test(line));
}

export async function applyFieldEdit(tenantId, fieldKey, rawValue) {
  const cfg = loadConfig();
  const field = CONFIG_FIELDS[fieldKey];
  if (!field) return { ok: false, error: `Unknown field: ${fieldKey}` };

  let value = rawValue;
  if (field.kind === 'channel_multi') {
    value = Array.isArray(value) ? value.map(String).join(',') : String(value);
    if (!value.split(',').every(v => /^\d{17,20}$/.test(v))) return { ok: false, error: 'Invalid channel selection.' };
  } else if (field.kind === 'channel' || field.kind === 'role') {
    value = Array.isArray(value) ? String(value[0]) : String(value);
    if (!/^\d{17,20}$/.test(value)) return { ok: false, error: 'Pick a valid channel or role from the list.' };
  } else if (field.kind === 'boolean') {
    if (!['true', 'false'].includes(String(value))) return { ok: false, error: 'Pick on or off.' };
    value = String(value) === 'true';
  } else {
    if (!isSafeText(value)) return { ok: false, error: 'Value contains characters that aren’t allowed.' };
    value = value.trim();
  }

  if (field.kind === 'secret') {
    if (!value) return { ok: false, error: 'Value cannot be empty.' };
    await setTenantSecret(tenantId, fieldKey === 'erlcServerKey' ? 'erlc_server_key' : 'pow_token', value, cfg.tenantSecretEncKey);
  } else {
    await updateTenant(tenantId, { [field.dbField]: value }, cfg.tenantSecretEncKey);
  }

  invalidateTenant(tenantId);
  return { ok: true, message: `Saved **${field.label}**.` };
}
