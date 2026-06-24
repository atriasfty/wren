import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { loadConfig } from './config.js';
import { runMigrations, closePool } from './db/migrate.js';
import { setEncryptionKey, resolveTenantById } from './tenant/resolve.js';
import { listTenants } from './tenant/store.js';
import { createClient } from './discord/client.js';
import { attachMessageHandler } from './discord/messageHandler.js';
import { attachTicketHandler } from './discord/ticketHandler.js';
import { attachRaidMonitor, stopAllRaidPollers } from './discord/raidMonitor.js';
import { attachIngameBridge } from './discord/ingameBridge.js';
import { dispatchGarminCommand } from './slash/handlers.js';
import { registerCommandsForGuild, syncAllGuilds } from './slash/register.js';
import { startApiServer } from './api/server.js';
import { pruneExpiredEvents } from './tenant/store.js';

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
  attachTicketHandler(client);
  attachIngameBridge(client);

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
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
      try { await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true }); } catch {}
    }
  });

  client.on('guildCreate', async (guild) => {
    try { await registerCommandsForGuild(client, guild.id); } catch (err) { console.warn('[guildCreate] register failed:', err.message); }
  });

  await syncAllGuilds(client);
  console.log('[boot] slash commands synced');

  const ctxs = [];
  for (const t of tenants) {
    const c = await resolveTenantById(t.tenantId);
    if (c) ctxs.push(c);
  }
  attachRaidMonitor(client, ctxs);

  setInterval(() => pruneExpiredEvents().catch(() => {}), 60 * 60 * 1000);

  await startApiServer();

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  function shutdown() {
    console.log('[shutdown] stopping...');
    stopAllRaidPollers();
    client.destroy().catch(() => {});
    closePool().finally(() => process.exit(0));
  }
}

main().catch((err) => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});
