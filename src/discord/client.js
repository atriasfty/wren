import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { loadConfig } from '../config.js';

let currentClient = null;

export function getClient() {
  return currentClient;
}

export async function createClient() {
  const cfg = loadConfig();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.on('error', (err) => console.error('[discord] client error:', err.message));
  client.on('shardError', (err) => console.error('[discord] shard error:', err.message));

  await client.login(cfg.discordToken);
  await new Promise((resolve) => client.once('ready', () => resolve()));
  console.log(`[discord] logged in as ${client.user.tag} (${client.user.id})`);
  
  currentClient = client;
  return client;
}
