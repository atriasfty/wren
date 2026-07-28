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
  listBans,
  addBan,
  removeBan,
  listMemory,
  removeMemory,
  incrementMessageUsage,
  decrementMessageUsage,
  countRecentPersonalityReviews,
  audit,
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
import { reviewPersonalityText } from '../ai/personalityReview.js';

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

// Discord caps embed descriptions at 4096 chars — keep headroom so a long
// list or message never turns into a raw API error for the user.
const MAX_EMBED_DESC = 3900;

function ephemeral(text) {
  const t = String(text ?? '');
  const safe = t.length > MAX_EMBED_DESC ? `${t.slice(0, MAX_EMBED_DESC - 1)}…` : t;
  return { embeds: [new EmbedBuilder().setColor(0x0bb0d1).setDescription(safe)], ephemeral: true };
}

function errorEphemeral(text) {
  return { embeds: [new EmbedBuilder().setColor(0xff3333).setDescription(`❌ ${text}`)], ephemeral: true };
}

// Renders a list of lines into a single ephemeral embed, keeping under the
// description cap and saying explicitly how many entries were omitted.
function listEphemeral(lines, { header = null } = {}) {
  const out = [];
  let used = header ? header.length + 1 : 0;
  for (const line of lines) {
    if (used + line.length + 1 > MAX_EMBED_DESC - 80) break;
    out.push(line);
    used += line.length + 1;
  }
  const omitted = lines.length - out.length;
  const parts = [];
  if (header) parts.push(header);
  parts.push(out.join('\n'));
  if (omitted > 0) parts.push(`…and **${omitted}** more (${lines.length} total).`);
  return ephemeral(parts.join('\n'));
}

function needLeadership(ctx) {
  const roleId = ctx?.tenant?.leadershipRoleId;
  return ephemeral(
    `You need the Leadership role${roleId ? ` (<@&${roleId}>)` : ''} or the **Manage Server** permission for this.`,
  );
}

async function loadCtx(interaction) {
  const cfg = loadConfig();
  const ctx = await resolveTenantByGuildId(interaction.guild.id);
  return { ctx, cfg };
}

export async function handleSetup(interaction) {
  if (!(await checkManageGuild(interaction))) return ephemeral('You need the **Manage Server** permission for this.');
  const { ctx, cfg } = await loadCtx(interaction);
  if (ctx) {
    return ephemeral('This server is already set up. Use `/wren config view` to manage it.');
  }
  await createTenant({
    tenantId: interaction.guild.id,
    displayName: interaction.guild.name,
    ownerDiscordId: interaction.guild.ownerId,
    encKey: cfg.tenantSecretEncKey,
  });
  // Overridable so a redeploy on a different host doesn't ship a wrong IP.
  const egressIp = process.env.WREN_EGRESS_IP || '152.53.21.47';
  return {
    embeds: [new EmbedBuilder().setColor(0x0bb0d1).setDescription(`✅ **Wren is now configured for this server!**\n\n⚠️ **IMPORTANT**: You must whitelist Wren's IP (\`${egressIp}\`) in your ERLC server dashboard (https://api.erlc.gg/server-owners), otherwise Wren won't be able to connect or perform any actions.\n\nYou can now use \`/wren config view\` to set up your channels, API keys, and options.\nBe sure to check out the setup guide at **https://wren.atriasafety.org** to learn how to add knowledge sources.`)],
    ephemeral: false
  };
}



export async function handleConfig(interaction, ctx) {
  if (RANK_ORDER[resolveActorRank({ kind: 'discord', member: interaction.member, id: interaction.user.id }, ctx)] < RANK_ORDER['leadership']) {
    return needLeadership(ctx);
  }

  const panel = await buildMainPanel(interaction.guild.id);
  if (!panel) return ephemeral('Could not load configuration.');
  return { ...panel, ephemeral: true };
}

const SOURCE_KIND_LABELS = { discord_channel: 'channel', website: 'website', manual_doc: 'document' };

function describeSource(kind, ref, label = null) {
  const display = kind === 'discord_channel' ? `<#${ref}>` : `\`${ref}\``;
  return `${SOURCE_KIND_LABELS[kind] || kind} ${display}${label ? ` \u2014 ${label}` : ''}`;
}

export async function handleSources(interaction, ctx) {
  if (RANK_ORDER[resolveActorRank({ kind: 'discord', member: interaction.member, id: interaction.user.id }, ctx)] < RANK_ORDER['leadership']) {
    return needLeadership(ctx);
  }
  const sub = interaction.options.getSubcommand();
  const tenantId = interaction.guild.id;

  if (sub === 'list') {
    const rows = await listSources(tenantId);
    if (!rows.length) return ephemeral('No sources configured. Add one with `/wren sources add`.');
    const lines = rows.map((r) => `${r.enabled ? '\u2705' : '\u26d4'} ${describeSource(r.kind, r.ref, r.label)}`);
    return listEphemeral(lines, { header: `**${rows.length}** source${rows.length === 1 ? '' : 's'} configured:` });
  }

  if (sub === 'add') {
    const kind = interaction.options.getString('kind');
    const channel = interaction.options.getChannel?.('channel');
    let ref = interaction.options.getString('ref');
    const label = interaction.options.getString('label') || null;

    if (kind === 'discord_channel') {
      ref = channel?.id || ref;
      if (!ref || !/^\d{17,20}$/.test(ref)) {
        return errorEphemeral('For a channel source, pick the channel with the **channel** option.');
      }
    } else if (!ref) {
      return errorEphemeral(`Provide the **ref** option: ${kind === 'website' ? 'the page URL' : 'the document filename'}.`);
    } else if (kind === 'website') {
      let url;
      try { url = new URL(ref); } catch { url = null; }
      if (!url || !['http:', 'https:'].includes(url.protocol)) {
        return errorEphemeral('That doesn\u2019t look like a valid website URL \u2014 it should start with `https://`.');
      }
    }

    await addSource({ tenantId, kind, ref, label });
    return ephemeral(`\u2705 Added ${describeSource(kind, ref, label)}.\nRun \`/wren ingest run\` to index it now.`);
  }

  if (sub === 'remove') {
    const kind = interaction.options.getString('kind');
    const ref = interaction.options.getString('ref');
    await removeSource({ tenantId, kind, ref });
    return ephemeral(`Removed ${describeSource(kind, ref)}.`);
  }

  if (sub === 'toggle') {
    const kind = interaction.options.getString('kind');
    const ref = interaction.options.getString('ref');
    const enabled = interaction.options.getBoolean('enabled');
    await setSourceEnabled({ tenantId, kind, ref, enabled });
    return ephemeral(`${enabled ? 'Enabled' : 'Disabled'} ${describeSource(kind, ref)}.`);
  }

  return ephemeral(`Unknown subcommand: ${sub}`);
}

// Autocomplete for the `ref` option on `/wren sources remove|toggle`:
// suggests the server's existing sources (filtered by the chosen kind and the
// typed prefix) so users never have to re-type a URL or channel id exactly.
export async function handleSourcesAutocomplete(interaction) {
  if (!interaction.guild?.id) return interaction.respond([]);
  const kind = interaction.options.getString('kind');
  const typed = String(interaction.options.getFocused() ?? '').toLowerCase();

  let rows = [];
  try { rows = await listSources(interaction.guild.id); } catch { /* fall through to empty */ }

  const choices = rows
    .filter((r) => (!kind || r.kind === kind))
    .filter((r) => !typed || r.ref.toLowerCase().includes(typed) || (r.label || '').toLowerCase().includes(typed))
    // Discord caps choice values at 100 chars; a truncated ref would silently
    // fail to match on remove/toggle, so skip over-long refs instead.
    .filter((r) => r.ref.length <= 100)
    .slice(0, 25)
    .map((r) => ({
      name: `${SOURCE_KIND_LABELS[r.kind] || r.kind}: ${r.label ? `${r.label} (${r.ref})` : r.ref}`.slice(0, 100),
      value: r.ref,
    }));
  return interaction.respond(choices);
}

// Renders `discord:123` keys as user mentions; other keys stay as code.
function formatUserKey(userKey) {
  if (!userKey) return '`?`';
  const m = /^discord:(\d{17,20})$/.exec(userKey);
  return m ? `<@${m[1]}>` : `\`${userKey}\``;
}

export async function handleBans(interaction, ctx) {
  const actorRankStr = resolveActorRank({ kind: 'discord', member: interaction.member, id: interaction.user.id }, ctx);
  if (RANK_ORDER[actorRankStr] < RANK_ORDER['leadership']) {
    return needLeadership(ctx);
  }
  const sub = interaction.options.getSubcommand();
  const tenantId = interaction.guild.id;

  if (sub === 'list') {
    const rows = await listBans(tenantId);
    if (!rows.length) return ephemeral('No bans.');
    const lines = rows.map((b) => {
      const when = b.created_at ? ` \u2014 <t:${Math.floor(new Date(b.created_at).getTime() / 1000)}:d>` : '';
      return `\u2022 ${formatUserKey(b.user_key)} \u2014 ${b.reason || '(no reason)'} (by ${formatUserKey(b.banned_by)})${when}`;
    });
    return listEphemeral(lines, { header: `**${rows.length}** ban${rows.length === 1 ? '' : 's'}:` });
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
    // Listing exposes every user's private memories — leadership only.
    if (!isLeadershipOrHigher) return needLeadership(ctx);
    const rows = await listMemory(tenantId);
    if (!rows.length) return ephemeral('No memories saved yet. Add one with `/wren memory add`.');
    const lines = rows.map((m) => `[#${m.id} ${m.scope}${m.user_key ? ` ${formatUserKey(m.user_key)}` : ''}] ${m.content}`);
    return listEphemeral(lines, { header: `**${rows.length}** memor${rows.length === 1 ? 'y' : 'ies'}:` });
  }

  if (sub === 'add') {
    const scope = interaction.options.getString('scope');
    const content = interaction.options.getString('content');
    if (scope === 'server' && !isLeadershipOrHigher) return needLeadership(ctx);
    const userKey = scope === 'user' ? `discord:${interaction.user.id}` : null;
    const { addMemory } = await import('../tenant/store.js');
    await addMemory({ tenantId, scope, userKey, content, addedBy: `discord:${interaction.user.id}` });
    return ephemeral(`Saved ${scope} memory.`);
  }

  if (sub === 'remove') {
    if (!isLeadershipOrHigher) return needLeadership(ctx);
    const id = interaction.options.getInteger('id');
    await removeMemory(tenantId, id);
    return ephemeral(`Removed memory #${id}.`);
  }

  return ephemeral(`Unknown subcommand: ${sub}`);
}

export async function handleIngest(interaction, ctx) {
  const actorRankStr = resolveActorRank({ kind: 'discord', member: interaction.member, id: interaction.user.id }, ctx);
  if (RANK_ORDER[actorRankStr] < RANK_ORDER['leadership']) {
    return needLeadership(ctx);
  }
  const sub = interaction.options.getSubcommand();

  if (sub === 'run') {
    const kind = interaction.options.getString('kind') || 'all';

    const initialEmbed = new EmbedBuilder()
      .setColor(0x0bb0d1)
      .setDescription('Starting ingestion…\n\n*This may take a few minutes depending on how many sources are configured and how much content they contain.*');

    await interaction.reply({ embeds: [initialEmbed], ephemeral: true });

    // Interaction tokens die after 15 minutes and big ingestions can exceed
    // that — if editReply fails, fall back to posting in the channel so the
    // outcome is never silently lost.
    async function reportOutcome(embed) {
      try {
        await interaction.editReply({ embeds: [embed] });
      } catch {
        await interaction.channel?.send({
          content: `<@${interaction.user.id}>`,
          embeds: [embed],
          allowedMentions: { users: [interaction.user.id] },
        }).catch((err) => console.error('[ingest] failed to report outcome:', err.message));
      }
    }

    try {
      const result = await ingestTenant(ctx, interaction.client, { kinds: [kind] });
      await reportOutcome(new EmbedBuilder().setColor(0x0bb0d1).setDescription(`✅ Ingestion done. Processed ${result.chunks} chunks from ${result.sources ?? 0} sources.`));
    } catch (err) {
      console.error('[ingest] run failed:', err);
      await reportOutcome(new EmbedBuilder().setColor(0xff3333).setDescription('❌ Ingestion failed. Check that your sources are reachable (`/wren sources list`) and try again — if it keeps failing, contact support.'));
    }
    return null;
  }

  if (sub === 'status') {
    const sources = await listSources(interaction.guild.id);
    if (!sources.length) return ephemeral('No sources configured. Add one with `/wren sources add`.');
    const lines = sources.map((s) => {
      const last = s.lastIngestedAt ? ` (last indexed <t:${Math.floor(new Date(s.lastIngestedAt).getTime() / 1000)}:R>)` : ' (never indexed)';
      return `${s.lastIngestedAt ? '\u2705' : '\u23f3'} ${describeSource(s.kind, s.ref, s.label)}${last}`;
    });
    return listEphemeral(lines);
  }

  return ephemeral(`Unknown subcommand: ${sub}`);
}

import { Polar } from '@polar-sh/sdk';

export async function handleUpgrade(interaction) {
  if (!(await checkManageGuild(interaction))) return ephemeral('You need the **Manage Server** permission for this.');
  const { ctx } = await loadCtx(interaction);
  if (!ctx) return ephemeral('Server not set up.');
  const plan = interaction.options.getString('plan');
  const productId = plan === 'core' ? process.env.POLAR_CORE_PRODUCT_ID : process.env.POLAR_PRO_PRODUCT_ID;
  if (!productId) return ephemeral('Billing is not fully configured yet (missing product IDs).');

  // Polar checkout creation can exceed the 3s interaction window.
  await interaction.deferReply({ ephemeral: true }).catch(() => {});

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
    const smallServerDiscountId = process.env.POLAR_SMALL_SERVER_DISCOUNT_ID || '5549ff1d-7616-45e7-ad0b-ba68937274a0';
    if (isSmallServer) {
      checkoutBody.discountId = smallServerDiscountId;
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
  const limits = { free: 10, core: 1000, pro: 5000 };
  const limit = limits[tier] || 10;
  // The counter is allowed to reach limit+1 internally (see
  // incrementMessageUsage) — clamp for display so users never see "11 / 10".
  const used = Math.min(ctx.tenant.monthlyMessageCount || 0, limit);
  const voiceLimits = { free: 2, core: 30, pro: 120 };
  const voiceLimitMins = voiceLimits[tier] || 2;
  const voiceUsedMins = Math.min(Math.round((ctx.tenant.monthlyVoiceTimeSeconds || 0) / 60), voiceLimitMins);
  const resetAt = ctx.tenant.billingCycleReset ? Math.floor(new Date(ctx.tenant.billingCycleReset).getTime() / 1000) : null;
  return ephemeral(
    `This server is on the **${tier.toUpperCase()}** plan.\n` +
    `Messages used this cycle: **${used} / ${limit}**\n` +
    `Voice minutes used this cycle: **${voiceUsedMins} / ${voiceLimitMins}**` +
    (resetAt ? `\nUsage resets <t:${resetAt}:R> (<t:${resetAt}:D>).` : ''),
  );
}

export async function handleManage(interaction) {
  const { ctx } = await loadCtx(interaction);
  if (!ctx) return ephemeral('Server not set up.');

  // Multiple Polar API round-trips can exceed the 3s interaction window.
  await interaction.deferReply({ ephemeral: true }).catch(() => {});

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

export async function dispatchWrenCommand(interaction) {
  const group = interaction.options.getSubcommandGroup();
  const sub = interaction.options.getSubcommand();

  const readOnly = new Set([
    'config:view', 'sources:list',
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
  // content: '' clears any lingering "Saved …" confirmation from a previous
  // edit when the user navigates elsewhere in the panel.
  return { content: '', embeds: panel.embeds, components: panel.components, ephemeral: ephemeralFlag };
}

export async function handleMcp(interaction) {
  const { ctx } = await loadCtx(interaction);
  if (!ctx) return ephemeral('Server not set up.');

  // If a token already exists, don't rotate it on a bare command run — that
  // would silently break the user's working agent setup. Ask first.
  const existing = await query(
    'SELECT 1 FROM user_mcp_tokens WHERE tenant_id = $1 AND discord_id = $2',
    [interaction.guild.id, interaction.user.id],
  );
  if (existing.rows.length > 0) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`wren_mcp_regen:${interaction.guild.id}`)
        .setLabel('Regenerate token')
        .setStyle(ButtonStyle.Danger),
    );
    return {
      embeds: [new EmbedBuilder()
        .setColor(0x0bb0d1)
        .setTitle('Wren MCP Access')
        .setDescription('You already have an MCP token for this server.\n\n⚠️ Regenerating creates a new token and **immediately invalidates the old one** — any agent using it will stop working until you update its config.')],
      components: [row],
      ephemeral: true,
    };
  }

  return issueMcpToken(ctx, interaction.guild.id, interaction.user.id);
}

export async function issueMcpToken(ctx, tenantId, discordId) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

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
      { name: 'Your MCP Token', value: `\`\`\`${rawToken}\`\`\`\n*Keep this secret. Regenerating a token invalidates the previous one.*`, inline: false },
      { name: 'Installation (Claude Desktop)', value: `1. Open your Claude Desktop config file (\`claude_desktop_config.json\`).\n2. Add the Wren MCP server:\n\`\`\`json\n"mcpServers": {\n  "wren-mcp": {\n    "command": "npx",\n    "args": [\n      "-y",\n      "mcp-proxy",\n      "--headers", "Authorization", "Bearer ${rawToken}",\n      "https://wrenapi.atriasafety.org/api/mcp/sse"\n    ]\n  }\n}\n\`\`\``, inline: false }
    );
    
  return { embeds: [embed], ephemeral: true };
}

// Behaviour fields whose free text feeds straight into Wren's system prompt
// and therefore goes through the AI moderation reviewer before being saved.
const REVIEWED_FIELDS = new Set(['coreInfo', 'responseStyle']);

// Personality-change confirmations awaiting a leadership member's approve/deny
// click once a tenant has exhausted its free reviews for the trailing 12h
// window (see countRecentPersonalityReviews). Short-lived and in-memory —
// losing these on a restart just means the submitter has to resubmit.
const pendingPersonalityReviews = new Map();

function prunePendingReviews() {
  const now = Date.now();
  for (const [token, pending] of pendingPersonalityReviews) {
    if (pending.expiresAt < now) pendingPersonalityReviews.delete(token);
  }
}

// Atomically claims a pending $atria personality-bypass grant for this tenant,
// if one exists and hasn't expired. DELETE...RETURNING makes the claim
// single-use even under concurrent submissions - two requests racing for the
// same row can't both consume it.
async function claimPersonalityBypass(tenantId) {
  const res = await query('DELETE FROM global_state WHERE key = $1 RETURNING value', [`personality_bypass:${tenantId}`]);
  if (res.rowCount === 0) return null;
  const val = res.rows[0].value;
  if (!val?.expiresAt || new Date(val.expiresAt) <= new Date()) return null;
  return val;
}

// Runs the moderation reviewer for a coreInfo/responseStyle submission,
// applies the edit if approved, records the outcome to audit_log (which also
// drives the 12h free-review counter), and returns a message describing the
// result for posting in the channel.
async function runPersonalityReview({ tenantId, tenantCtx, fieldKey, rawValue, requesterId, chargeQuota }) {
  const field = CONFIG_FIELDS[fieldKey];

  const bypass = await claimPersonalityBypass(tenantId).catch(() => null);
  if (bypass) {
    await applyFieldEdit(tenantId, fieldKey, rawValue);
    // Distinct action name (not 'personality_review') so a bypassed edit
    // never gets silently absorbed into normal review history - anyone
    // auditing this tenant sees exactly which staff member granted the
    // bypass and which change went in unreviewed.
    await audit({
      tenantId,
      actor: requesterId,
      action: 'personality_review_bypassed',
      target: fieldKey,
      metadata: { grantedBy: bypass.grantedBy, value: rawValue },
    });
    return { outcome: 'approved', message: `✅ <@${requesterId}> updated **${field.label}** (moderation bypassed via \`$atria personality bypass\`, granted by <@${bypass.grantedBy}>).` };
  }

  if (chargeQuota) {
    const tier = tenantCtx.tenant.subscriptionTier || 'free';
    const limit = { free: 10, core: 1000, pro: 5000 }[tier] || 10;
    const used = await incrementMessageUsage(tenantId, limit);
    if (used > limit) {
      return { outcome: 'quota_exceeded', message: `⚠️ This server has used all its included messages this month, so this change can't be reviewed right now. A server manager can run \`/wren upgrade\` to raise the limit.` };
    }
  }

  const result = await reviewPersonalityText({ fieldLabel: field.label, value: rawValue });

  if (chargeQuota && result.errored) {
    await decrementMessageUsage(tenantId).catch((e) => console.warn('[personalityReview] usage refund failed:', e.message));
  }

  await audit({
    tenantId,
    actor: requesterId,
    action: 'personality_review',
    target: fieldKey,
    metadata: { approved: result.approved, reason: result.reason, quotaCharged: chargeQuota && !result.errored },
  });

  if (result.approved) {
    await applyFieldEdit(tenantId, fieldKey, rawValue);
    return { outcome: 'approved', message: `✅ <@${requesterId}> updated **${field.label}**.` };
  }
  return { outcome: 'denied', message: `❌ <@${requesterId}>'s change to **${field.label}** was rejected: ${result.reason}` };
}

export async function handleComponentInteraction(interaction) {
  const customId = interaction.customId || '';
  const [route, tenantId, fieldKey] = customId.split(':');

  // The tenant id is carried in the component customId, but the permission
  // check below runs against interaction.member (the guild the click actually
  // came from). Refuse any component whose embedded tenant id isn't this guild,
  // so a forged customId can't write another tenant's config/secrets using the
  // clicker's rank in their own server.
  if (!interaction.guild?.id || tenantId !== interaction.guild.id) {
    return interaction.reply(ephemeral('This configuration control is not valid for this server.'));
  }

  const ctx = await resolveTenantByGuildId(tenantId);
  if (!ctx) return interaction.reply(ephemeral('Server not set up.'));

  // MCP token regeneration is not leadership-gated (any member can hold a
  // token scoped to their own rank), so handle it before the rank check.
  // The confirm prompt is an ephemeral message, so only its owner can click.
  if (route === 'wren_mcp_regen') {
    const payload = await issueMcpToken(ctx, tenantId, interaction.user.id);
    return interaction.update({ ...payload, components: [] });
  }

  const actorRankStr = resolveActorRank({ kind: 'discord', member: interaction.member, id: interaction.user?.id || 'unknown' }, ctx);
  if (RANK_ORDER[actorRankStr] < RANK_ORDER['leadership']) {
    const err = needLeadership(ctx);
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

  // Applies an edit (or clear) and re-renders the field's category panel with
  // a confirmation line, shared by the value-select, clear, and modal routes.
  async function applyAndRerender(rawValue) {
    const result = await applyFieldEdit(tenantId, fieldKey, rawValue);
    if (!result.ok) {
      return interaction.reply(errorEphemeral(result.error));
    }
    const category = CONFIG_CATEGORY_FOR_FIELD[fieldKey];
    const panel = category ? await buildCategoryPanel(tenantId, category) : await buildMainPanel(tenantId);
    if (!panel) return;
    return interaction.update({ ...panelPayload(panel), content: result.message });
  }

  if (route === 'wren_cfg_value') {
    const rawValue = interaction.values;
    if (!rawValue || rawValue.length === 0) return interaction.reply(ephemeral('No value selected.'));
    return applyAndRerender(rawValue);
  }

  if (route === 'wren_cfg_clear') {
    return applyAndRerender(null);
  }

  if (route === 'wren_cfg_back') {
    const panel = await buildMainPanel(tenantId);
    if (!panel) return;
    return interaction.update(panelPayload(panel));
  }

  if (route === 'wren_cfg_modal') {
    // An empty submission is a deliberate clear, so only a missing component
    // counts as "nothing submitted".
    const rawValue = extractModalValue(interaction);
    if (rawValue == null) {
      return interaction.reply(ephemeral('No value submitted.'));
    }

    const isClear = !rawValue.trim();
    if (!REVIEWED_FIELDS.has(fieldKey) || isClear) {
      return applyAndRerender(rawValue);
    }

    const field = CONFIG_FIELDS[fieldKey];
    const channel = interaction.channel;
    if (!channel) return interaction.reply(errorEphemeral('Could not access this channel to run the review.'));

    await interaction.deferUpdate();
    const publicMessage = await channel.send(`⏳ <@${interaction.user.id}> is updating **${field.label}** — reviewing…`);

    const recentCount = await countRecentPersonalityReviews(tenantId);
    if (recentCount < 3) {
      const result = await runPersonalityReview({
        tenantId, tenantCtx: ctx, fieldKey, rawValue, requesterId: interaction.user.id, chargeQuota: false,
      });
      await publicMessage.edit({ content: result.message });
      const panel = await buildCategoryPanel(tenantId, CONFIG_CATEGORY_FOR_FIELD[fieldKey]);
      if (panel) await interaction.editReply({ ...panelPayload(panel), content: result.outcome === 'approved' ? 'Saved.' : result.message });
      return;
    }

    prunePendingReviews();
    const token = crypto.randomBytes(6).toString('hex');
    pendingPersonalityReviews.set(token, {
      tenantId, fieldKey, rawValue, requesterId: interaction.user.id, expiresAt: Date.now() + 5 * 60 * 1000,
    });

    const approve = new ButtonBuilder().setCustomId(`wren_cfg_modreview:${tenantId}:${token}:approve`).setLabel('Approve').setStyle(ButtonStyle.Success);
    const deny = new ButtonBuilder().setCustomId(`wren_cfg_modreview:${tenantId}:${token}:deny`).setLabel('Deny').setStyle(ButtonStyle.Danger);
    await publicMessage.edit({
      content: `⚠️ <@${interaction.user.id}> wants to update **${field.label}**. This server has already used its free reviews in the last 12 hours — reviewing this one will use **1 message** from the server's monthly quota. A leadership member must approve or deny.`,
      components: [new ActionRowBuilder().addComponents(approve, deny)],
    });

    return interaction.editReply({ content: '⚠️ Waiting for a leadership member to confirm — this change would use part of your server’s message quota. See the message below.' });
  }

  if (route === 'wren_cfg_modreview') {
    const parts = customId.split(':');
    const token = parts[2];
    const action = parts[3];
    prunePendingReviews();
    const pending = pendingPersonalityReviews.get(token);
    if (!pending || pending.tenantId !== tenantId) {
      return interaction.reply(ephemeral('This confirmation has expired or was already used. Please resubmit the change.'));
    }
    pendingPersonalityReviews.delete(token);

    const field = CONFIG_FIELDS[pending.fieldKey];
    if (action === 'deny') {
      return interaction.update({
        content: `❌ <@${pending.requesterId}>'s change to **${field.label}** was cancelled — <@${interaction.user.id}> denied the quota confirmation.`,
        components: [],
      });
    }

    await interaction.update({ content: `⏳ <@${interaction.user.id}> approved — reviewing…`, components: [] });
    const result = await runPersonalityReview({
      tenantId, tenantCtx: ctx, fieldKey: pending.fieldKey, rawValue: pending.rawValue, requesterId: pending.requesterId, chargeQuota: true,
    });
    return interaction.editReply({ content: result.message });
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
