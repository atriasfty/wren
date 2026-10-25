import { resolveTenantByGuildId } from '../tenant/resolve.js';
import { runAssistantPipeline } from '../ai/pipeline.js';
import { enforceBan } from './guards.js';
import { ingestDiscordMessage, removeDiscordMessageChunks } from '../rag/ingest.js';
import { imageAttachments, describeImagesForContext } from '../ai/images.js';
import { query } from '../db/pool.js';
import { handleAtriaCommands } from './atriaCommands.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const MAX_RESPONSE_LEN = 1900;
const MAX_UPLOAD_BYTES = 9 * 1024 * 1024;

// Per-user in-flight guard: prevents duplicate concurrent pipeline runs.
const inFlight = new Set();

function publicErrorMessage() {
  return 'Sorry, something went wrong while processing that.';
}

export function splitForDiscord(text, limit = MAX_RESPONSE_LEN) {
  if (!text) return [''];
  // limit must stay >= 1: the cut-point fallback below only guarantees forward
  // progress (cut >= limit) when limit is positive — limit <= 0 previously
  // produced a non-advancing loop that hung the process forever.
  if (!Number.isFinite(limit) || limit < 1) limit = MAX_RESPONSE_LEN;
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

export async function fetchChannelContext(channel, beforeId, botId, count = 25) {
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
      return `[${name}]: ${m.content}${describeImagesForContext(m)}`;
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
 * True if the message contains a real mention of the bot ("<@id>" or "<@!id>")
 * anywhere in its text. @everyone/@here and role mentions don't count, and
 * neither does the reply ping alone: replies to the bot are handled separately
 * by the caller via the message reference.
 */
function isDirectlyMentioned(message, botUserId) {
  if (!message || !message.content) return false;
  return new RegExp(`<@!?${botUserId}>`).test(message.content);
}

// Removes every mention of the bot, wherever it sits, so the model sees
// "hey what's the server ip?" rather than "hey <@123> what's the server ip?".
function stripMention(content, botUserId) {
  return (content || '')
    .replace(new RegExp(`[ \\t]*<@!?${botUserId}>[ \\t]*`, 'g'), ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function attachMessageHandler(client) {
  // index.js no longer exits on an unhandled rejection, but a rejected
  // listener still loses the error context — catch at the boundary.
  client.on('messageCreate', (message) => {
    // Returned so callers (and tests) can await completion; it never rejects.
    return handleMessageCreate(message).catch((err) => {
      console.error('[messageCreate] handler failed:', err);
    });
  });

  async function handleMessageCreate(message) {
    if (message.author.id === client.user.id) return;
    if (message.author.bot) return;

    // $atria staff commands are checked before the guild gate below: several
    // of them (leave, broadcast, wipe, globalban, pause/unpause, etc.) are
    // meant to be issued via DM and take an explicit server ID rather than
    // relying on message.guild. Guarded here too: an uncaught rejection in
    // this messageCreate listener is an unhandled rejection process-wide,
    // and index.js treats those as fatal.
    try {
      if (await handleAtriaCommands(message)) return;
    } catch (err) {
      console.error('[messageCreate] handleAtriaCommands failed:', err);
      return;
    }

    if (!message.guild) return;

    let tenantCtx = await resolveTenantByGuildId(message.guild.id);
    if (!tenantCtx && isDirectlyMentioned(message, client.user.id)) {
      // A failed reply (e.g. missing SendMessages in this channel) must never
      // escape this listener — index.js exits the process on any unhandled
      // rejection, so an unguarded reply lets any user crash the whole bot.
      try { await message.reply('⚠️ This server is not configured with Wren yet. An admin must run `/wren setup` first.'); } catch {}
      return;
    } else if (!tenantCtx) {
      return;
    }

    const isSourceChannel = tenantCtx.sources.some(
      (s) => s.enabled && s.kind === 'discord_channel' && s.ref === message.channel.id
    );

    // Only respond if the bot is mentioned anywhere in the message,
    // or if the message is a direct reply to one of the bot's messages.
    const directlyMentioned = isDirectlyMentioned(message, client.user.id);

    // Optimization: Discord's 'message' object includes 'mentions.repliedUser' if it's a reply.
    // If repliedUser exists, we know who was replied to without fetching the parent message.
    let isReplyToBot = false;
    let refMsg = null;

    if (message.reference?.messageId) {
      if (message.mentions?.repliedUser) {
        isReplyToBot = message.mentions.repliedUser.id === client.user.id;
      } else {
        // Fallback: try cache first
        try {
          refMsg = message.channel.messages.cache.get(message.reference.messageId);
          if (refMsg) isReplyToBot = refMsg.author?.id === client.user.id;
        } catch {}
      }
    }

    // If we can easily determine we don't need to process this message, exit early
    // Note: if repliedUser isn't available and cache missed, we don't know if it's a reply to bot yet.
    // But if it's not a source channel and not mentioned, we'll only continue if there's a chance it's a reply to bot.
    const mightBeReplyToBot = message.reference?.messageId && !message.mentions?.repliedUser && !refMsg;
    if (!isSourceChannel && !directlyMentioned && !isReplyToBot && !mightBeReplyToBot) return;

    // Fetch message if we couldn't resolve from repliedUser or cache
    if (mightBeReplyToBot && !refMsg) {
       try {
         refMsg = await message.channel.messages.fetch(message.reference.messageId);
         if (refMsg) isReplyToBot = refMsg.author?.id === client.user.id;
       } catch {}

       if (!isSourceChannel && !directlyMentioned && !isReplyToBot) return;
    }

    // Now do the expensive DB checks
    const actor = { kind: 'discord', member: message.member, id: message.author.id };
    const isUserBanned = await enforceBan(tenantCtx, actor);

    // Checked before ingestion: a globally banned user's messages must not be
    // embedded into a tenant's knowledge base either.
    let isGloballyBanned = false;
    try {
      const banRes = await query("SELECT expires_at FROM global_bans WHERE discord_id = $1", [message.author.id]);
      if (banRes.rows.length > 0) {
        const expires = banRes.rows[0].expires_at;
        isGloballyBanned = !expires || new Date(expires) > new Date();
      }
    } catch (e) {
      console.error('[message] Global ban check error:', e);
    }

    if (isSourceChannel && !isUserBanned && !isGloballyBanned) {
      ingestDiscordMessage(tenantCtx, message).catch((err) => {
        console.error('[messageCreate] Auto-ingestion failed:', err.message);
      });
    }

    if (!directlyMentioned && !isReplyToBot) return;

    if (isUserBanned) {
      try { await message.reply('You are blocked from using this bot.'); } catch {}
      return;
    }

    // We still need refMsg for context if it's a reply but wasn't fetched yet
    if (!refMsg && message.reference?.messageId) {
      try {
        refMsg = message.channel.messages.cache.get(message.reference.messageId) ||
                 await message.channel.messages.fetch(message.reference.messageId);
      } catch {}
    }

    // Check global pause. The `return` must not live inside the try with the
    // reply: if the reply throws (e.g. missing permissions), the catch would
    // swallow it and processing would continue — bypassing the pause.
    let globallyPaused = false;
    try {
      const stateRes = await query("SELECT value FROM global_state WHERE key = 'paused'");
      globallyPaused = !!stateRes.rows[0]?.value?.paused;
    } catch (e) {
      console.error('[message] Global pause check error:', e);
    }
    if (globallyPaused) {
      try { await message.reply('Wren is currently undergoing maintenance and is paused globally. Please try again later.'); } catch {}
      return;
    }

    if (isGloballyBanned) return; // Ignore globally banned users entirely without a reply

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
            { name: 'Terms of Service', value: 'https://atriasfty.org/wren-tos' },
            { name: 'Privacy Policy', value: 'https://atriasfty.org/wren-privacy' },
            { name: 'Important Notice', value: 'Wren is an artificial intelligence system with access to the internet. Responses may therefore be inaccurate or incomplete, and users are advised to independently verify any information provided before relying upon it.' }
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
      replyContext = `[Replying to ${name}: "${refMsg.content}"${describeImagesForContext(refMsg)}]\n`;
    }

    const imageRefs = imageAttachments(message);
    let question = replyContext + stripMention(message.content, client.user.id);
    // A bare mention with only an image attached is a real request ("what's
    // this?"), not a poke — let the model look at the image.
    if (!question.trim() && imageRefs.length) {
      question = '(The user sent an image with no text.)';
    }
    if (!question || question.trim() === '') {
      // A bare mention with no text is usually someone poking the bot for the
      // first time — silence here reads as "broken". Point them at how to ask.
      try { await message.reply('Hi! Ask me something — e.g. `@Wren who’s online?` or `@Wren what are the server rules?`'); } catch {}
      return;
    }

    // Drop duplicate requests from the same user while one is in progress.
    const userId = message.author.id;
    if (inFlight.has(userId)) {
      try { await message.react('\u23f3'); } catch {}
      return;
    }
    inFlight.add(userId);
    // Everything between claiming the slot and releasing it lives in this
    // try, so no throw (attachment parsing, a Discord API error...) can leave
    // the user permanently locked out.
    try {
      await runForUser();
    } finally {
      inFlight.delete(userId);
    }

    async function runForUser() {
    const channelContext = await fetchChannelContext(message.channel, message.id, client.user.id);
    const imageUrls = imageRefs.map((r) => r.url);

    // Cap attachment downloads: only 20k chars survive anyway, so refuse to
    // buffer arbitrarily large uploads into memory.
    const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
    let documentsText = '';
    for (const a of message.attachments.values()) {
      if (a.size > MAX_ATTACHMENT_BYTES) {
        documentsText += `\n\n--- Attachment: ${a.name} --- (skipped: larger than 10MB)`;
        continue;
      }
      const isRawText = a.contentType?.startsWith('text/') ||
                        a.contentType === 'application/json' ||
                        a.contentType === 'application/xml' ||
                        /\.(txt|csv|md|json|xml|yaml|yml|js|py|html|css|log)$/i.test(a.name || '');

      if (isRawText) {
        try {
          const res = await fetch(a.url, { signal: AbortSignal.timeout(15_000) });
          const txt = await res.text();
          documentsText += `\n\n--- Attachment: ${a.name} ---\n${txt}`;
        } catch (e) {
          console.error('[message] Failed to read txt attachment:', e);
        }
      } else if (a.contentType === 'application/pdf' || a.name?.endsWith('.pdf')) {
        try {
          const res = await fetch(a.url, { signal: AbortSignal.timeout(15_000) });
          const buffer = await res.arrayBuffer();
          const pdfData = await pdfParse(Buffer.from(buffer));
          documentsText += `\n\n--- Attachment: ${a.name} ---\n${pdfData.text}`;
        } catch (e) {
          console.error('[message] Failed to read pdf attachment:', e);
        }
      }
    }
    if (documentsText.length > 20000) {
      documentsText = documentsText.substring(0, 20000) + '\n...[TRUNCATED due to length]';
    }

    await message.channel.sendTyping().catch(() => {});
    const typingInterval = setInterval(() => {
      message.channel.sendTyping().catch(() => {});
    }, 9000);

    // While the pipeline is working through tool calls, surface the model's
    // own lead-in ("Let me look that up...") as a live-edited status message
    // so the channel shows progress instead of just the typing indicator.
    let statusMessage = null;
    const onToolStep = async (leadIn) => {
      const raw = leadIn && leadIn.trim() ? leadIn.trim() : 'Working on it\u2026';
      const content = raw.length > MAX_RESPONSE_LEN ? `${raw.slice(0, MAX_RESPONSE_LEN)}\u2026` : raw;
      try {
        if (!statusMessage) {
          statusMessage = await message.reply({ content, allowedMentions: { parse: [] } });
        } else {
          await statusMessage.edit({ content, allowedMentions: { parse: [] } });
        }
      } catch (e) {
        console.warn('[message] status update failed:', e.message);
      }
    };

    let result;
    try {
      result = await runAssistantPipeline(tenantCtx, {
        question,
        channelContext,
        imageUrls,
        imageRefs,
        documentsText,
        actor,
        channelId: message.channel.id,
        onToolStep,
      });
      query('UPDATE tenants SET last_active_channel_id = $1 WHERE tenant_id = $2', [message.channel.id, message.guild.id]).catch(e => console.error('[message] Failed to update last active channel:', e));
    } catch (err) {
      console.error('[message] pipeline error:', err);
      try {
        if (statusMessage) await statusMessage.edit({ content: publicErrorMessage(), allowedMentions: { parse: [] } });
        else await message.reply(publicErrorMessage());
      } catch {}
      return;
    } finally {
      clearInterval(typingInterval);
    }

    const chunks = splitForDiscord(result.text || '');
    const noPings = { parse: [] };
    // Stay under Discord's upload limit (10 MB for unboosted servers); an
    // oversized message would otherwise fail and the user would get no answer.
    const files = [];
    let fileBytes = 0;
    for (const im of result.images || []) {
      if (fileBytes + im.buffer.length > MAX_UPLOAD_BYTES) continue;
      fileBytes += im.buffer.length;
      files.push({ attachment: im.buffer, name: im.filename });
    }
    let first = false;
    if (statusMessage) {
      try {
        await statusMessage.edit({ content: chunks[0] || '\u2026', allowedMentions: noPings, ...(files.length ? { files } : {}) });
        first = true;
      } catch (err) {
        // Status message deleted or uneditable — fall back to a fresh reply
        // below rather than dropping the whole answer.
        console.warn('[message] status edit failed, sending fresh reply:', err.message);
      }
    }
    try {
      if (!first) {
        const first0 = { content: chunks[0] || '\u2026', allowedMentions: noPings, ...(files.length ? { files } : {}) };
        await message.reply(first0).catch(() => message.channel.send(first0)).catch(async (err) => {
          // Attachments are the likeliest reason a send fails: deliver the text.
          if (!files.length) throw err;
          console.warn('[message] send with attachments failed, retrying text-only:', err.message);
          await message.channel.send({ content: chunks[0] || '\u2026', allowedMentions: noPings });
        });
      }
      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send({ content: chunks[i], allowedMentions: noPings });
      }
    } catch (err) {
      console.error('[message] send failed:', err.message);
    }
    }
  }

  client.on('messageUpdate', (oldMessage, newMessage) => {
    // Returned so callers (and tests) can await completion; it never rejects.
    return handleMessageUpdate(newMessage).catch((err) => {
      console.error('[messageUpdate] handler failed:', err);
    });
  });

  async function handleMessageUpdate(newMessage) {
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
      const actor = { kind: 'discord', member: newMessage.member, id: newMessage.author?.id };
      if (await enforceBan(tenantCtx, actor)) return;
      ingestDiscordMessage(tenantCtx, newMessage).catch((err) => {
        console.error('[messageUpdate] Auto-ingestion failed:', err.message);
      });
    }
  }

  client.on('messageDelete', (message) => {
    // Returned so callers (and tests) can await completion; it never rejects.
    return handleMessageDelete(message).catch((err) => {
      console.error('[messageDelete] handler failed:', err);
    });
  });

  async function handleMessageDelete(message) {
    // A deleted message can no longer be fetched — but its IDs are always
    // available, even on partials, and that's all the cleanup needs.
    const guildId = message.guildId;
    const channelId = message.channelId;
    if (!guildId || !channelId) return;

    const tenantCtx = await resolveTenantByGuildId(guildId);
    if (!tenantCtx) return;

    const isSourceChannel = tenantCtx.sources.some(
      (s) => s.enabled && s.kind === 'discord_channel' && s.ref === channelId
    );
    if (isSourceChannel) {
      removeDiscordMessageChunks(tenantCtx, message.id).catch((err) => {
        console.error('[messageDelete] Auto-remove failed:', err.message);
      });
    }
  }
}
