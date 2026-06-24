import { resolveTenantByGuildId } from '../tenant/resolve.js';
import { runAssistantPipeline } from '../ai/pipeline.js';
import { enforceBan } from './guards.js';
import { ingestDiscordMessage, removeDiscordMessageChunks } from '../rag/ingest.js';

const MENTION_RE = /^<@!?(\d+)>/;
const MAX_RESPONSE_LEN = 1900;

// Per-user in-flight guard: prevents duplicate concurrent pipeline runs.
const inFlight = new Set();

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

async function fetchChannelContext(channel, beforeId, count = 8) {
  if (!channel?.isTextBased?.()) return null;
  try {
    const opts = { limit: count + 1 };
    if (beforeId) opts.before = beforeId;
    const msgs = await channel.messages.fetch(opts);
    const sorted = [...msgs.values()]
      .filter((m) => !m.author.bot)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .slice(-count);
    return sorted.map((m) => `[${m.author.username}]: ${m.content}`).join('\n');
  } catch {
    return null;
  }
}

function isMentioned(message, botUserId) {
  if (!message) return false;
  return !!message.mentions?.users?.has?.(botUserId);
}

function stripMention(content, botUserId) {
  return (content || '').replace(new RegExp(`^<@!?${botUserId}>\\s*`), '').trim();
}

export function attachMessageHandler(client) {
  client.on('messageCreate', async (message) => {
    if (!message.guild) return;
    if (message.author.id === client.user.id) return;
    if (message.author.bot) return;

    const tenantCtx = await resolveTenantByGuildId(message.guild.id);
    if (!tenantCtx) {
      if (isMentioned(message, client.user.id)) {
        try {
          await message.reply('This server is not configured with Wren yet. Ask an admin to run `/wren setup`.');
        } catch {}
      }
      return;
    }

    const isSourceChannel = tenantCtx.sources.some(
      (s) => s.enabled && s.kind === 'discord_channel' && s.ref === message.channel.id
    );
    if (isSourceChannel) {
      ingestDiscordMessage(tenantCtx, message).catch((err) => {
        console.error('[messageCreate] Auto-ingestion failed:', err.message);
      });
    }

    const actor = { kind: 'discord', member: message.member };
    if (await enforceBan(tenantCtx, actor)) {
      try { await message.reply('You are blocked from using this bot.'); } catch {}
      return;
    }

    const mentioned = isMentioned(message, client.user.id);
    const isReplyToBot = message.reference?.messageId
      ? await (async () => {
          try {
            const ref = await message.channel.messages.fetch(message.reference.messageId);
            return ref?.author?.id === client.user.id;
          } catch { return false; }
        })()
      : false;

    if (!mentioned && !isReplyToBot) return;

    const question = stripMention(message.content, client.user.id);
    if (!question) return;

    // Drop duplicate requests from the same user while one is in progress.
    const userId = message.author.id;
    if (inFlight.has(userId)) {
      try { await message.react('\u23f3'); } catch {}
      return;
    }
    inFlight.add(userId);

    const channelContext = await fetchChannelContext(message.channel, message.id);
    const imageUrls = [...message.attachments.values()]
      .filter((a) => a.contentType?.startsWith?.('image/'))
      .map((a) => a.url);

    await message.channel.sendTyping().catch(() => {});

    let result;
    try {
      result = await runAssistantPipeline(tenantCtx, {
        question,
        channelContext,
        imageUrls,
        actor,
      });
    } catch (err) {
      console.error('[message] pipeline error:', err);
      try { await message.reply(`Sorry, something went wrong: ${err.message}`); } catch {}
      return;
    } finally {
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
