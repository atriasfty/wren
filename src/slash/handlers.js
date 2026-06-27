import { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { query } from '../db/pool.js';
import { resolveActorRank, RANK_ORDER } from '../ai/policy.js';
import crypto from 'crypto';
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
import { handleVoice } from '../discord/voice/manager.js';

const CONFIG_CATEGORY_FOR_FIELD = Object.fromEntries(
  Object.entries(CONFIG_FIELDS).map(([k, f]) => [k, f.category])
);

async function checkManageGuild(interaction) {
  if (interaction.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  try {
    const res = await query("SELECT value FROM global_state WHERE key = $1", [`bypass:${interaction.user.id}`]);
    if (res.rows.length > 0) {
      const val = res.rows[0].value;
      if (val.tenantId === interaction.guild?.id && new Date(val.expiresAt) > new Date()) return true;
    }
  } catch (e) {}
  return false;
}

async function isOwner(interaction) {
  if (interaction.guild?.ownerId === interaction.user.id) return true;
  try {
    const res = await query("SELECT value FROM global_state WHERE key = $1", [`bypass:${interaction.user.id}`]);
    if (res.rows.length > 0) {
      const val = res.rows[0].value;
      if (val.tenantId === interaction.guild?.id && new Date(val.expiresAt) > new Date()) return true;
    }
  } catch (e) {}
  return false;
}

function ephemeral(text) {
  return { embeds: [new EmbedBuilder().setColor(0x0bb0d1).setDescription(text)], ephemeral: true };
}

async function loadCtx(interaction) {
  const cfg = loadConfig();
  const ctx = await resolveTenantByGuildId(interaction.guild.id);
  return { ctx, cfg };
}

export async function handleSetup(interaction) {
  if (!(await checkManageGuild(interaction))) return ephemeral('You need ManageGuild permission for this.');
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
    embeds: [new EmbedBuilder().setColor(0x0bb0d1).setDescription("✅ **Wren is now configured for this server!**\n\n⚠️ **IMPORTANT**: You must whitelist Wren's IP (`152.53.21.47`) in your ERLC server dashboard (https://api.erlc.gg/server-owners), otherwise Wren won't be able to connect or perform any actions.\n\nYou can now use `/wren config view` to set up your channels, API keys, and options.\nBe sure to check out the setup guide at **https://wrendocs.atriasafety.org** to learn how to add knowledge sources.")],
    ephemeral: false
  };
}



export async function handleConfig(interaction, ctx) {
  if (RANK_ORDER[resolveActorRank({ kind: 'discord', member: interaction.member, id: interaction.user.id }, ctx)] < RANK_ORDER['leadership']) {
    return ephemeral('You need the Leadership role for this.');
  }

  const panel = await buildMainPanel(interaction.guild.id);
  if (!panel) return ephemeral('Could not load configuration.');
  return { ...panel, ephemeral: true };
}

export async function handleSources(interaction, ctx) {
  if (RANK_ORDER[resolveActorRank({ kind: 'discord', member: interaction.member, id: interaction.user.id }, ctx)] < RANK_ORDER['leadership']) {
    return ephemeral('You need the Leadership role for this.');
  }
  const sub = interaction.options.getSubcommand();
  const tenantId = interaction.guild.id;

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

export async function handlePolicy(interaction, ctx) {
  if (RANK_ORDER[resolveActorRank({ kind: 'discord', member: interaction.member, id: interaction.user.id }, ctx)] < RANK_ORDER['leadership']) {
    return ephemeral('You need the Leadership role for this.');
  }
  const sub = interaction.options.getSubcommand();
  const tenantId = interaction.guild.id;

  if (sub === 'view') {
    const policy = await getPolicy(tenantId);
    const lines = Object.entries(policy).sort().map(([k, v]) => `\`${k}\` \u2192 ${v}`);
    return ephemeral(lines.length ? lines.join('\n') : '(no policy rows)');
  }

  return ephemeral(`Unknown subcommand: ${sub}`);
}

export async function handleBans(interaction, ctx) {
  const actorRankStr = resolveActorRank({ kind: 'discord', member: interaction.member, id: interaction.user.id }, ctx);
  if (RANK_ORDER[actorRankStr] < RANK_ORDER['leadership']) {
    return ephemeral('You need the Leadership role for this.');
  }
  const sub = interaction.options.getSubcommand();
  const tenantId = interaction.guild.id;

  if (sub === 'list') {
    const rows = await listBans(tenantId);
    if (!rows.length) return ephemeral('No bans.');
    return ephemeral(rows.map((b) => `\u2022 \`${b.userKey}\` \u2014 ${b.reason || '(no reason)'} (by ${b.bannedBy || '?'})`).join('\n'));
  }

  if (sub === 'add') {
    const target = interaction.options.getUser('target');
    
    // Check rank
    let targetMember;
    try {
      targetMember = await interaction.guild.members.fetch(target.id);
    } catch (e) {}
    const targetRankStr = targetMember ? resolveActorRank({ kind: 'discord', member: targetMember, id: target.id }, ctx) : 'user';
    
    if (RANK_ORDER[actorRankStr] <= RANK_ORDER[targetRankStr]) {
      return ephemeral('You cannot ban a user with an equal or higher role than yourself.');
    }

    const reason = interaction.options.getString('reason') || null;
    const userKey = `discord:${target.id}`;
    await addBan({ tenantId, userKey, reason, bannedBy: `discord:${interaction.user.id}` });
    return ephemeral(`Banned \`${userKey}\`${reason ? ` \u2014 ${reason}` : ''}.`);
  }

  if (sub === 'remove') {
    const target = interaction.options.getUser('target');
    
    let targetMember;
    try {
      targetMember = await interaction.guild.members.fetch(target.id);
    } catch (e) {}
    const targetRankStr = targetMember ? resolveActorRank({ kind: 'discord', member: targetMember, id: target.id }, ctx) : 'user';
    
    if (RANK_ORDER[actorRankStr] <= RANK_ORDER[targetRankStr]) {
      return ephemeral('You cannot unban a user with an equal or higher role than yourself.');
    }

    const userKey = `discord:${target.id}`;
    await removeBan({ tenantId, userKey });
    return ephemeral(`Unbanned \`${userKey}\`.`);
  }

  return ephemeral(`Unknown subcommand: ${sub}`);
}

export async function handleMemory(interaction, ctx) {
  const actorRankStr = resolveActorRank({ kind: 'discord', member: interaction.member, id: interaction.user.id }, ctx);
  const isLeadershipOrHigher = RANK_ORDER[actorRankStr] >= RANK_ORDER['leadership'];
  
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
    if (scope === 'server' && !isLeadershipOrHigher) return ephemeral('Only the leadership role can add server-scoped memory.');
    const userKey = scope === 'user' ? `discord:${interaction.user.id}` : null;
    const { addMemory } = await import('../tenant/store.js');
    await addMemory({ tenantId, scope, userKey, content, addedBy: `discord:${interaction.user.id}` });
    return ephemeral(`Saved ${scope} memory.`);
  }

  if (sub === 'remove') {
    if (!isLeadershipOrHigher) return ephemeral('Only the leadership role can remove memories.');
    const id = interaction.options.getInteger('id');
    await removeMemory(tenantId, id);
    return ephemeral(`Removed memory #${id}.`);
  }

  return ephemeral(`Unknown subcommand: ${sub}`);
}

export async function handleIngest(interaction, ctx) {
  const actorRankStr = resolveActorRank({ kind: 'discord', member: interaction.member, id: interaction.user.id }, ctx);
  if (RANK_ORDER[actorRankStr] < RANK_ORDER['leadership']) {
    return ephemeral('Only the leadership role can run ingestion.');
  }
  const sub = interaction.options.getSubcommand();

  if (sub === 'run') {
    const kind = interaction.options.getString('kind') || 'all';
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await ingestTenant(ctx, interaction.client, { kinds: [kind] });
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x0bb0d1).setDescription(`Ingestion done. ${result.chunks} chunks from ${result.sources ?? 0} sources.`)] });
    } catch (err) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x0bb0d1).setDescription(`Ingestion failed: ${err.message}`)] });
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
  if (!(await checkManageGuild(interaction))) return ephemeral('You need ManageGuild permission for this.');
  const { ctx } = await loadCtx(interaction);
  if (!ctx) return ephemeral('Server not set up.');
  const plan = interaction.options.getString('plan');
  const productId = plan === 'core' ? process.env.POLAR_CORE_PRODUCT_ID : process.env.POLAR_PRO_PRODUCT_ID;
  if (!productId) return ephemeral('Billing is not fully configured yet (missing product IDs).');

  try {
    const polar = new Polar({ accessToken: process.env.POLAR_ACCESS_TOKEN || '' });
    const isSmallServer = interaction.guild.memberCount < 500;
    const checkoutBody = {
      products: [productId],
      successUrl: `https://discord.com/channels/${interaction.guild.id}`,
      externalCustomerId: interaction.user.id,
      metadata: { tenantId: interaction.guild.id, ownerId: interaction.user.id },
      customerMetadata: { discordId: interaction.user.id }
    };
    if (isSmallServer) {
      checkoutBody.discountId = '5549ff1d-7616-45e7-ad0b-ba68937274a0';
    }
    const checkout = await polar.checkouts.create(checkoutBody);
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

  const polar = new Polar({ accessToken: process.env.POLAR_ACCESS_TOKEN || '' });
  
  let serverPortalUrl = null;
  let userPortalUrl = null;

  if (ctx.tenant.polarCustomerId) {
    if (!ctx.tenant.subscriptionOwnerId || ctx.tenant.subscriptionOwnerId === interaction.user.id) {
      try {
        const session = await polar.customerSessions.create({
          customerId: ctx.tenant.polarCustomerId,
        });
        serverPortalUrl = session.customerPortalUrl;
      } catch (err) {
        console.error('Server customer portal error:', err);
      }
    }
  }

  try {
    const customers = await polar.customers.list({ externalCustomerId: interaction.user.id });
    if (customers.items && customers.items.length > 0) {
      const myCustomer = customers.items[0];
      const session = await polar.customerSessions.create({
        customerId: myCustomer.id,
      });
      userPortalUrl = session.customerPortalUrl;
    }
  } catch (err) {
    console.error('User customer portal error:', err);
  }

  const components = [];
  const row = new ActionRowBuilder();

  const voiceMins = Math.round((ctx.tenant.monthlyVoiceTimeSeconds || 0) / 60);
  let message = `**Server Subscription:**\nTier: ${ctx.tenant.subscriptionTier || 'free'}\nUsage: ${ctx.tenant.monthlyMessageCount || 0} msgs, ${voiceMins} voice mins\n`;

  if (serverPortalUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Manage Server Subscription')
        .setStyle(ButtonStyle.Link)
        .setURL(serverPortalUrl)
    );
  } else if (ctx.tenant.polarCustomerId) {
    message += `\n*(You cannot manage the server subscription as you are not the owner.)*\n`;
  } else if (ctx.tenant.subscriptionTier && ctx.tenant.subscriptionTier !== 'free') {
    message += `\n*(This server has been manually upgraded by Atria Staff. There is no billing portal to manage.)*\n`;
  } else {
    message += `\n*(No active paid server subscription found.)*\n`;
  }

  if (userPortalUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Manage Personal Subscriptions')
        .setStyle(ButtonStyle.Link)
        .setURL(userPortalUrl)
    );
  }

  if (row.components.length > 0) {
    components.push(row);
  } else if (!serverPortalUrl && !userPortalUrl) {
    message += `\nNo active subscriptions found for you or this server.`;
  }

  return { embeds: [new EmbedBuilder().setColor(0x0bb0d1).setDescription(message)], components, ephemeral: true };
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
    } else if (sub === 'mcp') {
      reply = await handleMcp(interaction);
    } else {
      reply = ephemeral('Unknown command.');
    }
  } else {
    const { ctx } = await loadCtx(interaction);
    if (!ctx) {
      reply = ephemeral('⚠️ This server is not configured with Wren yet. An admin must run `/wren setup` first.');
    } else {
      switch (group) {
        case 'config': reply = await handleConfig(interaction, ctx); break;
        case 'sources': reply = await handleSources(interaction, ctx); break;
        case 'policy': reply = await handlePolicy(interaction, ctx); break;
        case 'bans': reply = await handleBans(interaction, ctx); break;
        case 'memory': reply = await handleMemory(interaction, ctx); break;
        case 'ingest': reply = await handleIngest(interaction, ctx); break;
        case 'voice': reply = await handleVoice(interaction); break;
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

export async function handleMcp(interaction) {
  const { ctx } = await loadCtx(interaction);
  if (!ctx) return ephemeral('Server not set up.');
  
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  
  const tenantId = interaction.guild.id;
  const discordId = interaction.user.id;
  
  await query(`
    INSERT INTO user_mcp_tokens (tenant_id, discord_id, token_hash) 
    VALUES ($1, $2, $3)
    ON CONFLICT (tenant_id, discord_id) 
    DO UPDATE SET token_hash = $3, created_at = NOW(), last_used_at = NULL
  `, [tenantId, discordId, tokenHash]);
  
  const embed = new EmbedBuilder()
    .setTitle('Wren MCP Access')
    .setColor(0x0bb0d1)
    .setDescription(`You have generated an MCP API key for this server (\`${ctx.tenant.displayName}\`). This gives your AI agents the same access you have in Discord!`)
    .addFields(
      { name: 'Your MCP Token', value: `\`\`\`${rawToken}\`\`\`\n*Keep this secret. If you run this command again, the old token will be invalidated.*`, inline: false },
      { name: 'Installation (Claude Desktop)', value: `1. Open your Claude Desktop config file (\`claude_desktop_config.json\`).\n2. Add the Wren MCP server:\n\`\`\`json\n"mcpServers": {\n  "wren-mcp": {\n    "command": "npx",\n    "args": [\n      "-y",\n      "mcp-proxy",\n      "https://wrenapi.atriasafety.org/api/mcp/sse"\n    ],\n    "env": {\n      "WREN_MCP_TOKEN": "${rawToken}"\n    }\n  }\n}\n\`\`\``, inline: false }
    );
    
  return { embeds: [embed], ephemeral: true };
}

export async function handleComponentInteraction(interaction) {
  const customId = interaction.customId || '';
  const [route, tenantId, fieldKey] = customId.split(':');

  const { loadConfig } = await import('../config.js');
  const cfg = loadConfig();
  const ctx = await resolveTenantByGuildId(tenantId);
  if (!ctx) return interaction.reply(ephemeral('Server not set up.'));

  const actorRankStr = resolveActorRank({ kind: 'discord', member: interaction.member, id: interaction.user?.id || 'unknown' }, ctx);
  if (RANK_ORDER[actorRankStr] < RANK_ORDER['leadership']) {
    const err = ephemeral('You need the Leadership role for this.');
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
      if (!panel) return interaction.reply(ephemeral('Unknown setting.'));
      return interaction.update(panelPayload(panel));
    }
    return interaction.showModal(modal);
  }

  if (route === 'wren_cfg_value') {
    const rawValue = interaction.values;
    if (!rawValue || rawValue.length === 0) return interaction.reply(ephemeral('No value selected.'));
    const result = await applyFieldEdit(tenantId, fieldKey, rawValue);
    if (!result.ok) {
      return interaction.reply(ephemeral(`Error: ${result.error}`));
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
      return interaction.reply(ephemeral('No value submitted.'));
    }
    const result = await applyFieldEdit(tenantId, fieldKey, rawValue);
    if (!result.ok) {
      return interaction.reply(ephemeral(`Error: ${result.error}`));
    }
    const category = CONFIG_CATEGORY_FOR_FIELD[fieldKey];
    const panel = category ? await buildCategoryPanel(tenantId, category) : await buildMainPanel(tenantId);
    if (!panel) return;
    return interaction.update({ ...panelPayload(panel), content: result.message });
  }

  console.warn('[panel] unknown route:', route, customId);
  return interaction.reply(ephemeral('Unknown panel action.'));
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
