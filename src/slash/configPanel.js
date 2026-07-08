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
} from 'discord.js';
import { resolveTenantByGuildId, invalidateTenant } from '../tenant/resolve.js';
import { updateTenant, setTenantSecret, getPolicy } from '../tenant/store.js';
import { loadConfig } from '../config.js';

// Field descriptors. `kind` controls what input the modal uses.
// `dbField` is the snake_case column on `tenants`. `label` is the embed label.
export const CONFIG_FIELDS = {
  // Identity
  displayName:    { dbField: 'display_name',    kind: 'text',     label: 'Server display name', category: 'Identity', placeholder: 'e.g. LA County Roleplay' },
  botDisplayName: { dbField: 'bot_display_name', kind: 'text',    label: 'Bot display name',    category: 'Identity', placeholder: 'e.g. Wren' },
  inGameHandle:   { dbField: 'in_game_handle',  kind: 'text',     label: 'In-game PM handle',   category: 'Identity', placeholder: 'e.g. :pm wren' },

  // Channels & Roles
  statusChannelId:    { dbField: 'status_channel_id',    kind: 'channel', label: 'Status channel',     category: 'Channels & Roles' },
  erlcLogChannelId:   { dbField: 'erlc_log_channel_id',  kind: 'channel', label: 'ERLC log channel',    category: 'Channels & Roles' },
  leadershipRoleId:   { dbField: 'leadership_role_id',   kind: 'role',    label: 'Leadership role',     category: 'Channels & Roles' },
  adminRoleId:        { dbField: 'admin_role_id',        kind: 'role',    label: 'Admin role',          category: 'Channels & Roles' },
  modRoleId:          { dbField: 'mod_role_id',          kind: 'role',    label: 'Mod role',            category: 'Channels & Roles' },

  // Behaviour
  coreInfo:      { dbField: 'core_info',      kind: 'longtext', label: 'Core info (always-on note)', category: 'Behaviour', placeholder: 'Server vibe, timezone, who to ping in an emergency…' },
  responseStyle: { dbField: 'response_style', kind: 'longtext', label: 'Response style',             category: 'Behaviour', placeholder: 'e.g. Be concise and formal. Never use slang or emojis.' },

  // Secrets
  erlcServerKey: { dbField: 'erlc_server_key_enc', kind: 'secret', label: 'ERLC server key', category: 'Secrets', placeholder: 'paste from the PRC dashboard' },
  powToken:      { dbField: 'pow_token_enc',       kind: 'secret', label: 'POW token',       category: 'Secrets', placeholder: 'paste your POW API token' },

};

// 'Policy' is a read-only category rendered from the tenant's tool policy
// table — it has no editable fields in CONFIG_FIELDS.
export const CONFIG_CATEGORIES = ['Identity', 'Channels & Roles', 'Behaviour', 'Secrets', 'Policy'];

// Free-text and secret fields are validated with a control-character denylist
// rather than an allowlist charset: server names, core info, and tokens
// legitimately contain non-Latin scripts, emoji, Discord mentions (<@id>),
// markdown, and arbitrary punctuation. Only control characters are dangerous
// (header/log injection, invisible content). Written as a charCode scan rather
// than a regex so the control-character range doesn't trip eslint's
// no-control-regex rule. Returns the offending char code, or null if clean.
function findControlChar(value, { allowNewlines = false } = {}) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (allowNewlines && (code === 0x0a || code === 0x0d)) continue;
    if (code <= 0x1f || code === 0x7f) return code;
  }
  return null;
}

function fieldValueFor(field, tenant) {
  const descriptor = CONFIG_FIELDS[field.key];
  switch (field.key) {
    case 'erlcServerKey': return tenant.erlcServerKey ? '•••••••• (set)' : '—';
    case 'powToken':      return tenant.powToken ? '•••••••• (set)' : '—';
    default:
      if (descriptor?.kind === 'boolean') return tenant[field.key] ? 'On' : 'Off';
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
      { name: 'Channels & Roles',  value: `Status: ${t.statusChannelId ? `<#${t.statusChannelId}>` : '—'}\nERLC log: ${t.erlcLogChannelId ? `<#${t.erlcLogChannelId}>` : '—'}\nLeadership role: ${t.leadershipRoleId ? `<@&${t.leadershipRoleId}>` : '—'}\nAdmin role: ${t.adminRoleId ? `<@&${t.adminRoleId}>` : '—'}\nMod role: ${t.modRoleId ? `<@&${t.modRoleId}>` : '—'}`, inline: false },
      { name: 'Behaviour', value: `Core info: ${t.coreInfo ? `${t.coreInfo.slice(0, 100)}${t.coreInfo.length > 100 ? '…' : ''}` : '—'}\nResponse style: ${t.responseStyle ? `${t.responseStyle.slice(0, 100)}${t.responseStyle.length > 100 ? '…' : ''}` : '—'}`, inline: false },
      { name: 'Secrets',   value: `ERLC key: ${t.erlcServerKey ? '•••• set' : '—'}\nPOW token: ${t.powToken ? '•••• set' : '—'}`, inline: false },
      { name: 'Policy',    value: 'Which rank can use each of Wren’s tools (read-only).', inline: false },
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

// Human-readable rank names, highest first, for the read-only Policy view.
const RANK_LABELS = [
  ['owner', 'Owner / Manage Server'],
  ['leadership', 'Leadership'],
  ['admin', 'Admin'],
  ['mod', 'Mod'],
  ['user', 'Everyone'],
];

async function buildPolicyPanel(tenantId, displayName) {
  const policy = await getPolicy(tenantId);
  const byRank = new Map(RANK_LABELS.map(([rank]) => [rank, []]));
  for (const [tool, rank] of Object.entries(policy).sort()) {
    (byRank.get(rank) ?? byRank.get('user')).push(tool.replace(/_/g, ' '));
  }

  const embed = new EmbedBuilder()
    .setTitle(`Policy — ${displayName}`)
    .setColor(0x0bb0d1)
    .setDescription(
      Object.keys(policy).length
        ? 'The minimum rank required to use each of Wren’s tools. This view is read-only.'
        : 'No tool policy is configured for this server yet.',
    );
  for (const [rank, label] of RANK_LABELS) {
    const tools = byRank.get(rank);
    if (!tools.length) continue;
    embed.addFields({ name: `${label} and above`, value: embedValue(tools.join(', ')), inline: false });
  }

  const back = new ButtonBuilder()
    .setCustomId(`wren_cfg_back:${tenantId}`)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(back)],
  };
}

export async function buildCategoryPanel(tenantId, category) {
  const ctx = await resolveTenantByGuildId(tenantId);
  if (!ctx) return null;
  const t = ctx.tenant;

  if (category === 'Policy') return buildPolicyPanel(tenantId, t.displayName);

  const fields = Object.entries(CONFIG_FIELDS).filter(([, f]) => f.category === category);
  const embed = new EmbedBuilder()
    .setTitle(`${category} — ${t.displayName}`)
    .setColor(0x0bb0d1)
    .setDescription('Pick a setting below to edit it. Your changes save when you submit the form. Leave a form empty to clear a setting.')
    .addFields(fields.map(([key, f]) => ({
      name: f.label,
      value: embedValue(fieldValueFor({ key }, t)),
      inline: false,
    })));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`wren_cfg_field:${tenantId}`)
    .setPlaceholder(`Edit a ${category.toLowerCase()} setting…`)
    .addOptions(fields.map(([key, f]) => ({ label: f.label, value: key })));

  const back = new ButtonBuilder()
    .setCustomId(`wren_cfg_back:${tenantId}`)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

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
  if (!field || !['channel', 'channel_multi', 'role', 'boolean'].includes(field.kind)) return null;

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

  const clear = new ButtonBuilder()
    .setCustomId(`wren_cfg_clear:${tenantId}:${fieldKey}`)
    .setLabel('Clear')
    .setStyle(ButtonStyle.Danger);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(picker),
      new ActionRowBuilder().addComponents(back, clear),
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
    // Optional so submitting an empty form clears the setting.
    .setRequired(false);

  const placeholder = field.placeholder ? `${field.placeholder} (leave empty to clear)` : 'Leave empty to clear this setting';
  input.setPlaceholder(placeholder.slice(0, 100));

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

function describeControlChar(code) {
  if (code === 0x0a || code === 0x0d) return 'a line break';
  if (code === 0x09) return 'a tab character';
  return `a control character (code ${code})`;
}

// A null rawValue — or an empty/whitespace-only text submission — clears the
// setting back to unset.
export async function applyFieldEdit(tenantId, fieldKey, rawValue) {
  const cfg = loadConfig();
  const field = CONFIG_FIELDS[fieldKey];
  if (!field) return { ok: false, error: `Unknown field: ${fieldKey}` };

  let value = rawValue;
  const isTextKind = ['text', 'longtext', 'secret'].includes(field.kind);
  const isClear = value == null || (isTextKind && typeof value === 'string' && !value.trim());

  if (isClear) {
    value = null;
  } else if (field.kind === 'channel_multi') {
    value = Array.isArray(value) ? value.map(String).join(',') : String(value);
    if (!value.split(',').every(v => /^\d{17,20}$/.test(v))) return { ok: false, error: 'Invalid channel selection.' };
  } else if (field.kind === 'channel' || field.kind === 'role') {
    value = Array.isArray(value) ? String(value[0]) : String(value);
    if (!/^\d{17,20}$/.test(value)) return { ok: false, error: 'Pick a valid channel or role from the list.' };
  } else if (field.kind === 'boolean') {
    if (!['true', 'false'].includes(String(value))) return { ok: false, error: 'Pick on or off.' };
    value = String(value) === 'true';
  } else {
    if (typeof value !== 'string') return { ok: false, error: 'Value must be text.' };
    if (value.length > 1800) return { ok: false, error: 'Value is too long (max 1800 characters).' };
    const badCode = findControlChar(value, { allowNewlines: field.kind === 'longtext' });
    if (badCode != null) {
      return { ok: false, error: `Value contains ${describeControlChar(badCode)}, which isn’t allowed in this field.` };
    }
    value = value.trim();
  }

  if (field.kind === 'secret') {
    await setTenantSecret(tenantId, fieldKey === 'erlcServerKey' ? 'erlc_server_key' : 'pow_token', value, cfg.tenantSecretEncKey);
  } else {
    await updateTenant(tenantId, { [field.dbField]: value }, cfg.tenantSecretEncKey);
  }

  invalidateTenant(tenantId);
  return { ok: true, message: isClear ? `Cleared **${field.label}**.` : `Saved **${field.label}**.` };
}
