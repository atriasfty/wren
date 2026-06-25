import { PermissionFlagsBits } from 'discord.js';
import {
  resolveTenantByGuildId,
  invalidateTenant,
} from '../tenant/resolve.js';
import {
  createTenant,
  listSources,
  addSource,
  removeSource,
  setSourceEnabled,
  getPolicy,
  listBans,
  addBan,
  removeBan,
  listMemory,
  removeMemory,
  pruneExpiredEvents,
} from '../tenant/store.js';
import { loadConfig } from '../config.js';
import { ingestTenant } from '../rag/ingest.js';
import {
  buildMainPanel,
  buildCategoryPanel,
  buildFieldModal,
  buildValueSelectPanel,
  applyFieldEdit,
  CONFIG_FIELDS,
} from './configPanel.js';

const CONFIG_CATEGORY_FOR_FIELD = Object.fromEntries(
  Object.entries(CONFIG_FIELDS).map(([k, f]) => [k, f.category])
);

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
  const ctx = await resolveTenantByGuildId(interaction.guild.id);
  return { ctx, cfg };
}

export async function handleSetup(interaction) {
  if (!checkManageGuild(interaction)) return ephemeral('You need ManageGuild permission for this.');
  const { ctx, cfg } = await loadCtx(interaction);
  if (ctx) {
    return ephemeral('This server is already set up. Use `/wren config` to manage it.');
  }
  await createTenant({
    tenantId: interaction.guild.id,
    displayName: interaction.guild.name,
    ownerDiscordId: interaction.guild.ownerId,
    encKey: cfg.tenantSecretEncKey,
  });
  return {
    content: "✅ **Wren is now configured for this server!**\n\n⚠️ **IMPORTANT**: You must whitelist Wren's IP (`152.53.21.47`) in your ERLC server dashboard (https://api.erlc.gg/server-owners), otherwise Wren won't be able to connect or perform any actions.\n\nYou can now use `/wren config view` to set up your channels, API keys, and options.\nBe sure to check out the setup guide at **https://wrendocs.atriasafety.org** to learn how to add knowledge sources.",
    ephemeral: false
  };
}



export async function handleConfig(interaction) {
  if (!checkManageGuild(interaction)) return ephemeral('You need ManageGuild permission for this.');
  const { ctx } = await loadCtx(interaction);

  const panel = await buildMainPanel(interaction.guild.id);
  if (!panel) return ephemeral('Could not load configuration.');
  return { ...panel, ephemeral: true };
}

export async function handleSources(interaction) {
  if (!checkManageGuild(interaction)) return ephemeral('You need ManageGuild permission for this.');
  const sub = interaction.options.getSubcommand();
  const tenantId = interaction.guild.id;
  const { ctx } = await loadCtx(interaction);

  if (sub === 'list') {
    const rows = await listSources(tenantId);
    if (!rows.length) return ephemeral('No sources configured.');
    const lines = rows.map((r) => `${r.enabled ? '\u2705' : '\u26d4'} \`${r.kind}\` ${r.ref}${r.label ? ` \u2014 ${r.label}` : ''}`);
    return ephemeral(lines.join('\n'));
  }

  if (sub === 'add') {
    const kind = interaction.options.getString('kind');
    const ref = interaction.options.getString('ref');
    const label = interaction.options.getString('label') || null;
    await addSource({ tenantId, kind, ref, label });
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
  if (!checkManageGuild(interaction)) return ephemeral('You need ManageGuild permission for this.');
  const sub = interaction.options.getSubcommand();
  const tenantId = interaction.guild.id;

  if (sub === 'view') {
    const policy = await getPolicy(tenantId);
    const lines = Object.entries(policy).sort().map(([k, v]) => `\`${k}\` \u2192 ${v}`);
    return ephemeral(lines.length ? lines.join('\n') : '(no policy rows)');
  }

  return ephemeral(`Unknown subcommand: ${sub}`);
}

export async function handleBans(interaction) {
  if (!checkManageGuild(interaction)) return ephemeral('You need ManageGuild permission for this.');
  const sub = interaction.options.getSubcommand();
  const tenantId = interaction.guild.id;

  if (sub === 'list') {
    const rows = await listBans(tenantId);
    if (!rows.length) return ephemeral('No bans.');
    return ephemeral(rows.map((b) => `\u2022 \`${b.userKey}\` \u2014 ${b.reason || '(no reason)'} (by ${b.bannedBy || '?'})`).join('\n'));
  }

  if (sub === 'add') {
    const target = interaction.options.getUser('target');
    const reason = interaction.options.getString('reason') || null;
    const userKey = `discord:${target.id}`;
    await addBan({ tenantId, userKey, reason, bannedBy: `discord:${interaction.user.id}` });
    return ephemeral(`Banned \`${userKey}\`${reason ? ` \u2014 ${reason}` : ''}.`);
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
  if (!checkManageGuild(interaction)) return ephemeral('You need ManageGuild permission for this.');
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
    const lines = sources.map((s) => `${s.lastIngestedAt ? '\u2705' : '\u23f3'} \`${s.kind}\` ${s.ref}${s.lastIngestedAt ? ` (last: ${s.lastIngestedAt.toISOString?.() ?? s.lastIngestedAt})` : ''}`);
    return ephemeral(lines.length ? lines.join('\n') : 'No sources configured.');
  }

  return ephemeral(`Unknown subcommand: ${sub}`);
}

import { Polar } from '@polar-sh/sdk';

export async function handleUpgrade(interaction) {
  if (!checkManageGuild(interaction)) return ephemeral('You need ManageGuild permission for this.');
  const { ctx } = await loadCtx(interaction);
  if (!ctx) return ephemeral('Server not set up.');
  const plan = interaction.options.getString('plan');
  const productId = plan === 'core' ? process.env.POLAR_CORE_PRODUCT_ID : process.env.POLAR_PRO_PRODUCT_ID;
  if (!productId) return ephemeral('Billing is not fully configured yet (missing product IDs).');

  try {
    const polar = new Polar({ accessToken: process.env.POLAR_ACCESS_TOKEN || '' });
    const isSmallServer = interaction.guild.memberCount < 500;
    const checkoutBody = {
      productId,
      successUrl: `https://discord.com/channels/${interaction.guild.id}`,
      customerExternalId: interaction.user.id,
      metadata: { tenantId: interaction.guild.id, ownerId: interaction.user.id },
      customerMetadata: { discordId: interaction.user.id }
    };
    if (isSmallServer) {
      checkoutBody.discountId = '5549ff1d-7616-45e7-ad0b-ba68937274a0';
    }
    const checkout = await polar.checkouts.custom.create(checkoutBody);
    return ephemeral(`Here is your checkout link for the **${plan.toUpperCase()}** plan${isSmallServer ? ' (with your 25% discount applied!)' : ''}:\n${checkout.url}`);
  } catch (err) {
    console.error('Checkout error:', err);
    return ephemeral('Failed to generate checkout link.');
  }
}

export async function handleUsage(interaction) {
  const { ctx } = await loadCtx(interaction);
  if (!ctx) return ephemeral('Server not set up.');
  const tier = ctx.tenant.subscriptionTier || 'free';
  const used = ctx.tenant.monthlyMessageCount || 0;
  const limits = { free: 10, core: 1000, pro: 5000 };
  const limit = limits[tier] || 10;
  return ephemeral(`You are currently on the **${tier.toUpperCase()}** plan.\nUsage this month: **${used} / ${limit}** messages.`);
}

export async function handleManage(interaction) {
  const { ctx } = await loadCtx(interaction);
  if (!ctx) return ephemeral('Server not set up.');
  if (ctx.tenant.subscriptionOwnerId && ctx.tenant.subscriptionOwnerId !== interaction.user.id) {
    return ephemeral('Only the user who originally purchased the subscription can manage it.');
  }
  if (!ctx.tenant.polarCustomerId) {
    return ephemeral('No active subscription found to manage.');
  }
  try {
    const polar = new Polar({ accessToken: process.env.POLAR_ACCESS_TOKEN || '' });
    const session = await polar.customerSessions.create({
      customerId: ctx.tenant.polarCustomerId,
    });
    return ephemeral(`Manage your subscription here:\n${session.customerPortalUrl}`);
  } catch (err) {
    console.error('Customer portal error:', err);
    return ephemeral('Failed to generate management link.');
  }
}

export async function dispatchGarminCommand(interaction) {
  const group = interaction.options.getSubcommandGroup();
  const sub = interaction.options.getSubcommand();

  const readOnly = new Set([
    'config:view', 'policy:view', 'sources:list',
    'bans:list', 'memory:list', 'ingest:status',
    ':usage'
  ]);
  const key = `${group ?? ''}:${sub ?? ''}`;

  let reply;
  if (group === null) {
    if (sub === 'setup') {
      reply = await handleSetup(interaction);
    } else if (sub === 'upgrade') {
      reply = await handleUpgrade(interaction);
    } else if (sub === 'usage') {
      reply = await handleUsage(interaction);
    } else if (sub === 'manage') {
      reply = await handleManage(interaction);
    } else {
      reply = ephemeral('Unknown command.');
    }
  } else {
    const { ctx } = await loadCtx(interaction);
    if (!ctx) {
      reply = ephemeral('⚠️ This server is not configured with Wren yet. An admin must run `/wren setup` first.');
    } else {
      switch (group) {
        case 'config': reply = await handleConfig(interaction); break;
        case 'sources': reply = await handleSources(interaction); break;
        case 'policy': reply = await handlePolicy(interaction); break;
        case 'bans': reply = await handleBans(interaction); break;
        case 'memory': reply = await handleMemory(interaction); break;
        case 'ingest': reply = await handleIngest(interaction); break;
        default: reply = ephemeral(`Unknown group: ${group}`);
      }
    }
  }

  if (!readOnly.has(key) && interaction.guild?.id) {
    invalidateTenant(interaction.guild.id);
  }
  return reply;
}

function panelPayload(panel, ephemeralFlag = true) {
  return { embeds: panel.embeds, components: panel.components, ephemeral: ephemeralFlag };
}

export async function handleComponentInteraction(interaction) {
  const customId = interaction.customId || '';
  const [route, tenantId, fieldKey] = customId.split(':');

  if (!checkManageGuild(interaction)) {
    const err = { content: 'You need ManageGuild permission for this.', ephemeral: true };
    if (interaction.replied || interaction.deferred) return interaction.followUp(err);
    return interaction.reply(err);
  }

  if (route === 'wren_cfg_cat') {
    const category = interaction.values?.[0];
    if (!category) return;
    const panel = await buildCategoryPanel(tenantId, category);
    if (!panel) return;
    return interaction.update(panelPayload(panel));
  }

  if (route === 'wren_cfg_field') {
    const selectedFieldKey = interaction.values?.[0];
    if (!selectedFieldKey) return;
    const modal = await buildFieldModal(tenantId, selectedFieldKey);
    if (!modal) {
      const panel = await buildValueSelectPanel(tenantId, selectedFieldKey);
      if (!panel) return interaction.reply({ content: 'Unknown setting.', ephemeral: true });
      return interaction.update(panelPayload(panel));
    }
    return interaction.showModal(modal);
  }

  if (route === 'wren_cfg_value') {
    const rawValue = interaction.values?.[0];
    if (rawValue == null) return interaction.reply({ content: 'No value selected.', ephemeral: true });
    const result = await applyFieldEdit(tenantId, fieldKey, rawValue);
    if (!result.ok) {
      return interaction.reply({ content: `Error: ${result.error}`, ephemeral: true });
    }
    const category = CONFIG_CATEGORY_FOR_FIELD[fieldKey];
    const panel = category ? await buildCategoryPanel(tenantId, category) : await buildMainPanel(tenantId);
    if (!panel) return;
    return interaction.update({ ...panelPayload(panel), content: result.message });
  }

  if (route === 'wren_cfg_back') {
    const panel = await buildMainPanel(tenantId);
    if (!panel) return;
    return interaction.update(panelPayload(panel));
  }

  if (route === 'wren_cfg_modal') {
    const rawValue = extractModalValue(interaction);
    if (rawValue == null) {
      return interaction.reply({ content: 'No value submitted.', ephemeral: true });
    }
    const result = await applyFieldEdit(tenantId, fieldKey, rawValue);
    if (!result.ok) {
      return interaction.reply({ content: `Error: ${result.error}`, ephemeral: true });
    }
    const category = CONFIG_CATEGORY_FOR_FIELD[fieldKey];
    const panel = category ? await buildCategoryPanel(tenantId, category) : await buildMainPanel(tenantId);
    if (!panel) return;
    return interaction.update({ ...panelPayload(panel), content: result.message });
  }

  console.warn('[panel] unknown route:', route, customId);
  return interaction.reply({ content: 'Unknown panel action.', ephemeral: true });
}

function extractModalValue(interaction) {
  for (const row of interaction.components || []) {
    for (const c of row.components || []) {
      if (c.customId === 'value') {
        if (c.values) return c.values[0];
        return c.value;
      }
    }
  }
  return null;
}
