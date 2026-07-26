import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ActionRowBuilder, ButtonBuilder } from 'discord.js';

// TODO [SECURITY]: upgrade vitest — breaking change, requires manual review
// TODO [SECURITY]: upgrade @modelcontextprotocol/sdk — breaking change, requires manual review
// TODO [SECURITY]: upgrade @opentelemetry/sdk-node — breaking change, requires manual review
// TODO [SECURITY]: upgrade @xenova/transformers — breaking change, requires manual review
// TODO [SECURITY]: upgrade sharp — breaking change, requires manual review

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
import { dispatchWrenCommand, handleComponentInteraction, handleSourcesAutocomplete } from './slash/handlers.js';
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

// Guards the ToS "Agree" button against double-clicks: two near-simultaneous
// clicks are two separate interactions, so Discord's own "can't reply twice"
// protection doesn't stop both from reaching this handler and both replaying
// the original message (double LLM run, double reply). Keyed by the button
// message's id, checked and set before any await so it's race-free.
const tosClickInFlight = new Set();

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
  // Belt-and-braces: a rejection escaping this listener would hit the fatal
  // unhandledRejection handler below and take down the whole bot.
  client.on('voiceStateUpdate', (oldState, newState) => {
    Promise.resolve(handleVoiceStateUpdate(oldState, newState)).catch((err) => {
      console.error('[voice] voiceStateUpdate handler failed:', err);
    });
  });

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName !== 'wren') return;
      try {
        await handleSourcesAutocomplete(interaction);
      } catch (err) {
        console.warn('[autocomplete] failed:', err.message);
        await interaction.respond([]).catch(() => {});
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== 'wren') return;
      try {
        const reply = await dispatchWrenCommand(interaction);
        if (reply) {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply(reply).catch(() => {});
          } else {
            await interaction.reply(reply).catch(async () => {
              await interaction.followUp(reply).catch(() => {});
            });
          }
        }
      } catch (err) {
        console.error('[slash] dispatch failed:', err);
        // Handlers that defer (upgrade, manage, voice join, ingest run) and then
        // throw would leave an eternal "thinking…" spinner if we only reply().
        try {
          const content = { content: publicInteractionError(), ephemeral: true };
          if (interaction.deferred || interaction.replied) await interaction.editReply(content);
          else await interaction.reply(content);
        } catch {}
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'agree_tos') {
        const dedupeKey = interaction.message.id;
        if (tosClickInFlight.has(dedupeKey)) {
          await interaction.reply({ content: 'Already processing your agreement — one moment!', ephemeral: true }).catch(() => {});
          return;
        }
        tosClickInFlight.add(dedupeKey);
        try {
          await query('INSERT INTO user_agreements (discord_id) VALUES ($1) ON CONFLICT DO NOTHING', [interaction.user.id]);

          // Disable the button so it can't be replayed again later — not just
          // during this race window, but from a stale click hours afterward.
          try {
            const existingButton = interaction.message.components?.[0]?.components?.[0];
            if (existingButton) {
              const disabledRow = new ActionRowBuilder().addComponents(
                ButtonBuilder.from(existingButton).setDisabled(true)
              );
              await interaction.message.edit({ components: [disabledRow] });
            }
          } catch (editErr) {
            console.warn('[slash] failed to disable agree_tos button:', editErr.message);
          }

          if (interaction.message.reference?.messageId) {
            const originalMsg = await interaction.channel.messages.fetch(interaction.message.reference.messageId).catch(()=>null);
            // Only replay the original request if the person agreeing is its
            // author — someone else's click must not consent on their behalf.
            if (originalMsg && originalMsg.author.id === interaction.user.id) {
              await interaction.reply({ content: 'Thank you for agreeing to the Terms of Service and Privacy Policy! Processing your original request...', ephemeral: true });
              interaction.client.emit('messageCreate', originalMsg);
            } else {
              await interaction.reply({ content: 'Thank you for agreeing to the Terms of Service and Privacy Policy! You can now use Wren.', ephemeral: true });
            }
          } else {
            await interaction.reply({ content: 'Thank you for agreeing to the Terms of Service and Privacy Policy! You can now use Wren.', ephemeral: true });
          }
        } catch (err) {
          console.error('[slash] button failed:', err);
          await interaction.reply({ content: 'Failed to record agreement.', ephemeral: true }).catch(() => {});
        } finally {
          tosClickInFlight.delete(dedupeKey);
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

  // Global commands persist — no need to re-register on an interval.
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

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] fatal:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] fatal:', reason);
  process.exit(1);
});
