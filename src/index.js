import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { initObservability } from './observability.js';
initObservability();

import { loadConfig } from './config.js';
import { runMigrations } from './db/migrate.js';
import { closePool, query } from './db/pool.js';
import { setEncryptionKey } from './tenant/resolve.js';
import { listTenants } from './tenant/store.js';
import { createClient } from './discord/client.js';
import { attachMessageHandler } from './discord/messageHandler.js';
import { attachIngameBridge } from './discord/ingameBridge.js';
import { attachTicketHandler } from './discord/ticketHandler.js';
import { dispatchGarminCommand, handleComponentInteraction } from './slash/handlers.js';
import { syncAllGuilds } from './slash/register.js';
import { startApiServer } from './api/server.js';
import { pruneExpiredEvents } from './tenant/store.js';
import { handleVoiceStateUpdate } from './discord/voice/manager.js';
import { fetchChannelContext, splitForDiscord } from './discord/messageHandler.js';
import { resolveTenantByGuildId } from './tenant/resolve.js';
import { runAssistantPipeline } from './ai/pipeline.js';

function publicInteractionError() {
  return 'Something went wrong while processing that request.';
}

async function main() {
  const cfg = loadConfig();
  setEncryptionKey(cfg.tenantSecretEncKey);
  console.log('[boot] config loaded');

  await runMigrations();
  console.log('[boot] migrations applied');

  const tenants = await listTenants(cfg.tenantSecretEncKey);
  console.log(`[boot] ${tenants.length} tenants loaded`);

  const client = await createClient();

  attachMessageHandler(client);
  attachIngameBridge(client);
  attachTicketHandler(client);
  
  client.on('voiceStateUpdate', handleVoiceStateUpdate);

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== 'wren') return;
      try {
        const reply = await dispatchGarminCommand(interaction);
        if (reply) {
          await interaction.reply(reply).catch(async () => {
            await interaction.followUp(reply).catch(() => {});
          });
        }
      } catch (err) {
        console.error('[slash] dispatch failed:', err);
        try { await interaction.reply({ content: publicInteractionError(), ephemeral: true }); } catch {}
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'agree_tos') {
        try {
          await query('INSERT INTO user_agreements (discord_id) VALUES ($1) ON CONFLICT DO NOTHING', [interaction.user.id]);
          if (interaction.message.reference?.messageId) {
            await interaction.reply({ content: 'Thank you for agreeing to the Terms of Service and Privacy Policy! Processing your original request...', ephemeral: true });
            const originalMsg = await interaction.channel.messages.fetch(interaction.message.reference.messageId).catch(()=>null);
            if (originalMsg) {
               interaction.client.emit('messageCreate', originalMsg);
            }
          } else {
            await interaction.reply({ content: 'Thank you for agreeing to the Terms of Service and Privacy Policy! You can now use Wren.', ephemeral: true });
          }
        } catch (err) {
          console.error('[slash] button failed:', err);
          await interaction.reply({ content: 'Failed to record agreement.', ephemeral: true });
        }
        return;
      }
      
      if (interaction.customId === 'agree_ticket_tos') {
        try {
          await query('INSERT INTO user_agreements (discord_id) VALUES ($1) ON CONFLICT DO NOTHING', [interaction.user.id]);
          await interaction.update({ content: 'Thank you! I am reviewing your ticket now...', embeds: [], components: [] });

          const tenantCtx = await resolveTenantByGuildId(interaction.guild.id);
          if (!tenantCtx) return;

          const channelContext = await fetchChannelContext(interaction.channel, interaction.message.id, client.user.id, 15);
          const question = `Please review this support ticket and provide assistance to the user:\n\n${channelContext || '(No context provided)'}`;

          const actor = { kind: 'discord', member: interaction.member, id: interaction.user.id, isTicket: true };

          const result = await runAssistantPipeline(tenantCtx, {
            question,
            channelContext: null, // we already put it in the question
            imageUrls: [],
            actor,
            channelId: interaction.channel.id,
          });

          const chunks = splitForDiscord(result.text || '');
          await interaction.channel.send({ content: chunks[0] || '\u2026', allowedMentions: { parse: [] } });
          for (let i = 1; i < chunks.length; i++) {
            await interaction.channel.send({ content: chunks[i], allowedMentions: { parse: [] } });
          }
        } catch (err) {
          console.error('[ticket] agree_ticket_tos failed:', err);
          try { await interaction.channel.send('Sorry, I encountered an error while reviewing the ticket.'); } catch {}
        }
        return;
      }
    }
    if (
      interaction.isStringSelectMenu() ||
      interaction.isChannelSelectMenu?.() ||
      interaction.isRoleSelectMenu?.() ||
      interaction.isButton() ||
      interaction.isModalSubmit()
    ) {
      try {
        await handleComponentInteraction(interaction);
      } catch (err) {
        console.error('[component] dispatch failed:', err);
        try {
          const content = { content: publicInteractionError(), ephemeral: true };
          if (interaction.replied || interaction.deferred) await interaction.followUp(content);
          else await interaction.reply(content);
        } catch {}
      }
    }
  });

// Global commands automatically apply to all guilds, so we don't need to register on guildCreate.

  await syncAllGuilds(client);
  console.log('[boot] slash commands synced');

  setInterval(() => syncAllGuilds(client).catch(() => {}), 3 * 60 * 1000);
  setInterval(() => pruneExpiredEvents().catch(() => {}), 60 * 60 * 1000);

  await startApiServer(client);

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  function shutdown() {
    console.log('[shutdown] stopping...');
    client.destroy().catch(() => {});
    closePool().finally(() => process.exit(0));
  }
}

main().catch((err) => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});
