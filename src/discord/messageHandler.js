import { resolveTenantByGuildId } from '../tenant/resolve.js';
import { runAssistantPipeline } from '../ai/pipeline.js';
import { enforceBan } from './guards.js';
import { ingestDiscordMessage, removeDiscordMessageChunks } from '../rag/ingest.js';
import { query } from '../db/pool.js';
import { handleAtriaCommands } from './atriaCommands.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const MAX_RESPONSE_LEN = 1900;

// Per-user in-flight guard: prevents duplicate concurrent pipeline runs.
const inFlight = new Set();

function publicErrorMessage() {
  return 'Sorry, something went wrong while processing that.';
}

export function splitForDiscord(text, limit = MAX_RESPONSE_LEN) {
  if (!text) return [''];
  if (text.length <= limit) return [text];
  const out = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.6) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.4) cut = limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

async function fetchChannelContext(channel, beforeId, botId, count = 25) {
  if (!channel?.isTextBased?.()) return null;
  try {
    const opts = { limit: count + 1 };
    if (beforeId) opts.before = beforeId;
    const msgs = await channel.messages.fetch(opts);
    const sorted = [...msgs.values()]
      .filter((m) => !m.author.bot || m.author.id === botId)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .slice(-count);

    const lines = sorted.map((m) => {
      const name = m.member?.nickname ? `${m.member.nickname} (${m.author.username})` : m.author.username;
      return `[${name}]: ${m.content}`;
    });
    const selected = [];
    let totalLen = 0;

    // Walk backwards to prioritize the most recent messages up to 5000 chars
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineLen = lines[i].length + (selected.length > 0 ? 1 : 0);
      if (totalLen + lineLen > 5000) break;
      selected.unshift(lines[i]);
      totalLen += lineLen;
    }

    return selected.length ? selected.join('\n') : null;
  } catch {
    return null;
  }
}

/**
 * Returns true only if the bot is directly addressed — i.e. the bot mention
 * is the FIRST token in the message content (after optional whitespace).
 * This prevents the bot from triggering when someone merely references it
 * mid-sentence, e.g. "hey did you ask @wren about this?".
 */
function isDirectlyMentioned(message, botUserId) {
  if (!message || !message.content) return false;
  const c = message.content.trim();
  return c.startsWith(`<@${botUserId}>`) || c.startsWith(`<@!${botUserId}>`);
}

function stripMention(content, botUserId) {
  return (content || '')
    .replace(new RegExp(`^\\s*<@!?${botUserId}>\\s*`), '')
    .trim();
}

export function attachMessageHandler(client) {
  client.on('messageCreate', async (message) => {
    if (!message.guild) return;
    if (message.author.id === client.user.id) return;
    if (message.author.bot) return;

    if (await handleAtriaCommands(message)) return;

    let tenantCtx = await resolveTenantByGuildId(message.guild.id);
    if (!tenantCtx && isDirectlyMentioned(message, client.user.id)) {
      return message.reply('⚠️ This server is not configured with Wren yet. An admin must run `/wren setup` first.');
    } else if (!tenantCtx) {
      return;
    }

    const actor = { kind: 'discord', member: message.member };
    const isUserBanned = await enforceBan(tenantCtx, actor);

    const isSourceChannel = tenantCtx.sources.some(
      (s) => s.enabled && s.kind === 'discord_channel' && s.ref === message.channel.id
    );
    if (isSourceChannel && !isUserBanned) {
      ingestDiscordMessage(tenantCtx, message).catch((err) => {
        console.error('[messageCreate] Auto-ingestion failed:', err.message);
      });
    }

    // Only respond if the bot is directly addressed at the start of the message,
    // or if the message is a direct reply to one of the bot's messages.
    const directlyMentioned = isDirectlyMentioned(message, client.user.id);
    let refMsg = null;
    if (message.reference?.messageId) {
      try { refMsg = await message.channel.messages.fetch(message.reference.messageId); } catch {}
    }
    const isReplyToBot = refMsg?.author?.id === client.user.id;

    if (!directlyMentioned && !isReplyToBot) return;

    if (isUserBanned) {
      try { await message.reply('You are blocked from using this bot.'); } catch {}
      return;
    }

    // Check global pause
    try {
      const stateRes = await query("SELECT value FROM global_state WHERE key = 'paused'");
      if (stateRes.rows[0]?.value?.paused) {
        await message.reply('Wren is currently undergoing maintenance and is paused globally. Please try again later.');
        return;
      }
    } catch (e) {
      console.error('[message] Global pause check error:', e);
    }

    // Check global ban
    try {
      const banRes = await query("SELECT expires_at FROM global_bans WHERE discord_id = $1", [message.author.id]);
      if (banRes.rows.length > 0) {
        const expires = banRes.rows[0].expires_at;
        if (!expires || new Date(expires) > new Date()) {
          return; // Ignore globally banned users entirely without a reply
        }
      }
    } catch (e) {
      console.error('[message] Global ban check error:', e);
    }

    // Check ToS Agreement
    try {
      const res = await query('SELECT 1 FROM user_agreements WHERE discord_id = $1', [message.author.id]);
      if (res.rows.length === 0) {
        const embed = new EmbedBuilder()
          .setTitle('Welcome to Wren!')
          .setDescription('Before you get started, please accept our Terms of Service and Privacy Policy. By clicking "Agree", you agree to both documents.')
          .setColor('#0099ff')
          .addFields(
            { name: 'Documentation', value: 'https://wren.atriasafety.org' },
            { name: 'Terms of Service', value: 'http://atriasfty.org/wren-tos' },
            { name: 'Privacy Policy', value: 'http://atriasfty.org/wren-privacy' }
          );
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('agree_tos')
            .setLabel('Agree')
            .setStyle(ButtonStyle.Primary)
        );

        await message.reply({ embeds: [embed], components: [row] });
        return;
      }
    } catch (err) {
      console.error('[message] ToS check error:', err);
      return;
    }

    let replyContext = '';
    if (refMsg) {
      const name = refMsg.member?.nickname ? `${refMsg.member.nickname} (${refMsg.author.username})` : refMsg.author.username;
      replyContext = `[Replying to ${name}: "${refMsg.content}"]\n`;
    }

    const question = replyContext + stripMention(message.content, client.user.id);
    if (!question || question.trim() === '') return;

    // Drop duplicate requests from the same user while one is in progress.
    const userId = message.author.id;
    if (inFlight.has(userId)) {
      try { await message.react('\u23f3'); } catch {}
      return;
    }
    inFlight.add(userId);

    const channelContext = await fetchChannelContext(message.channel, message.id, client.user.id);
    const imageUrls = [...message.attachments.values()]
      .filter((a) => a.contentType?.startsWith?.('image/'))
      .map((a) => a.url);

    await message.channel.sendTyping().catch(() => {});
    const typingInterval = setInterval(() => {
      message.channel.sendTyping().catch(() => {});
    }, 9000);

    let result;
    try {
      result = await runAssistantPipeline(tenantCtx, {
        question,
        channelContext,
        imageUrls,
        actor,
        channelId: message.channel.id,
      });
      query('UPDATE tenants SET last_active_channel_id = $1 WHERE tenant_id = $2', [message.channel.id, message.guild.id]).catch(e => console.error('[message] Failed to update last active channel:', e));
    } catch (err) {
      console.error('[message] pipeline error:', err);
      try { await message.reply(publicErrorMessage()); } catch {}
      return;
    } finally {
      clearInterval(typingInterval);
      inFlight.delete(userId);
    }

    const chunks = splitForDiscord(result.text || '');
    try {
      await message.reply({ content: chunks[0] || '\u2026', allowedMentions: { parse: [] } });
      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send({ content: chunks[i], allowedMentions: { parse: [] } });
      }
    } catch (err) {
      console.error('[message] send failed:', err.message);
    }
  });

  client.on('messageUpdate', async (oldMessage, newMessage) => {
    try {
      if (newMessage.partial) newMessage = await newMessage.fetch();
    } catch { return; }
    if (!newMessage.guild) return;
    if (newMessage.author?.bot) return;

    const tenantCtx = await resolveTenantByGuildId(newMessage.guild.id);
    if (!tenantCtx) return;

    const isSourceChannel = tenantCtx.sources.some(
      (s) => s.enabled && s.kind === 'discord_channel' && s.ref === newMessage.channel.id
    );
    if (isSourceChannel) {
      ingestDiscordMessage(tenantCtx, newMessage).catch((err) => {
        console.error('[messageUpdate] Auto-ingestion failed:', err.message);
      });
    }
  });

  client.on('messageDelete', async (message) => {
    // Fetch the full message if it's partial (uncached) to avoid null guild/channel
    try { if (message.partial) message = await message.fetch(); } catch { return; }
    if (!message) return;

    if (!message.guild) return;

    const tenantCtx = await resolveTenantByGuildId(message.guild.id);
    if (!tenantCtx) return;

    const isSourceChannel = tenantCtx.sources.some(
      (s) => s.enabled && s.kind === 'discord_channel' && s.ref === message.channel.id
    );
    if (isSourceChannel) {
      removeDiscordMessageChunks(tenantCtx, message.id).catch((err) => {
        console.error('[messageDelete] Auto-remove failed:', err.message);
      });
    }
  });
}
