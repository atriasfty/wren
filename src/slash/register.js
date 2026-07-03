import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { loadConfig } from '../config.js';

function buildCommandTree() {
  return [
    new SlashCommandBuilder()
      .setName('wren')
      .setDescription('Wren bot configuration and utilities')
      // Visible to everyone: user-facing subcommands (usage, voice, memory, mcp)
      // must be reachable; privileged subcommands enforce their own rank checks.
      .setDMPermission(false)
      .addSubcommandGroup((g) =>
        g.setName('config').setDescription('View or change server configuration').addSubcommand((s) => s.setName('view').setDescription('Open the configuration panel')),
      )
      .addSubcommandGroup((g) =>
        g.setName('sources').setDescription('Manage sources of truth (channels, websites, docs)').addSubcommand((s) => s.setName('list').setDescription('List configured sources'))
          .addSubcommand((s) =>
            s.setName('add').setDescription('Add a source').addStringOption((o) => o.setName('kind').setDescription('Source kind').setRequired(true).addChoices({ name: 'channel', value: 'discord_channel' }, { name: 'website', value: 'website' }, { name: 'document', value: 'manual_doc' }))
              .addStringOption((o) => o.setName('ref').setDescription('Channel ID, URL, or doc filename').setRequired(true))
              .addStringOption((o) => o.setName('label').setDescription('Label').setRequired(false)))
          .addSubcommand((s) => s.setName('remove').setDescription('Remove a source').addStringOption((o) => o.setName('kind').setDescription('Kind').setRequired(true).addChoices({ name: 'channel', value: 'discord_channel' }, { name: 'website', value: 'website' }, { name: 'document', value: 'manual_doc' })).addStringOption((o) => o.setName('ref').setDescription('Channel ID, URL, or filename').setRequired(true)))
          .addSubcommand((s) => s.setName('toggle').setDescription('Enable/disable a source').addStringOption((o) => o.setName('kind').setDescription('Kind').setRequired(true).addChoices({ name: 'channel', value: 'discord_channel' }, { name: 'website', value: 'website' }, { name: 'document', value: 'manual_doc' })).addStringOption((o) => o.setName('ref').setDescription('Channel ID, URL, or filename').setRequired(true)).addBooleanOption((o) => o.setName('enabled').setDescription('Enabled?').setRequired(true))))
      .addSubcommandGroup((g) =>
        g.setName('policy').setDescription('View tool permission policy')
          .addSubcommand((s) => s.setName('view').setDescription('Show the current policy')))
      .addSubcommandGroup((g) =>
        g.setName('bans').setDescription('Manage the Wren ban list').addSubcommand((s) => s.setName('list').setDescription('List bans'))
          .addSubcommand((s) => s.setName('add').setDescription('Ban a user').addUserOption((o) => o.setName('target').setDescription('User').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false)))
          .addSubcommand((s) => s.setName('remove').setDescription('Unban a user').addUserOption((o) => o.setName('target').setDescription('User').setRequired(true))))
      .addSubcommandGroup((g) =>
        g.setName('memory').setDescription('Manage long-term memory').addSubcommand((s) => s.setName('list').setDescription('List memories'))
          .addSubcommand((s) => s.setName('add').setDescription('Add a memory').addStringOption((o) => o.setName('scope').setDescription('Scope').setRequired(true).addChoices({ name: 'server', value: 'server' }, { name: 'user', value: 'user' })).addStringOption((o) => o.setName('content').setDescription('Content').setRequired(true)))
          .addSubcommand((s) => s.setName('remove').setDescription('Remove a memory by id').addIntegerOption((o) => o.setName('id').setDescription('Memory id').setRequired(true))))
      .addSubcommandGroup((g) =>
        g.setName('ingest').setDescription('Run or check knowledge-base ingestion')
          .addSubcommand((s) =>
            s.setName('run').setDescription('Run ingestion for this server')
              .addStringOption((o) => o.setName('kind').setDescription('What to ingest').setRequired(false)
                .addChoices({ name: 'all', value: 'all' }, { name: 'channels', value: 'channels' }, { name: 'websites', value: 'websites' }, { name: 'documents', value: 'documents' })))
          .addSubcommand((s) => s.setName('status').setDescription('Show ingestion status'))
      )
      .addSubcommand((s) => s.setName('setup').setDescription('Initialise Wren for this server'))
      .addSubcommand((s) =>
        s.setName('upgrade').setDescription('Upgrade your server\'s Wren plan')
          .addStringOption((o) => o.setName('plan').setDescription('The plan to upgrade to').setRequired(true).addChoices({ name: 'Core ($10/mo - 1k messages)', value: 'core' }, { name: 'Pro ($25/mo - 5k messages)', value: 'pro' }))
      )
      .addSubcommand((s) => s.setName('usage').setDescription('Check your current billing cycle usage'))
      .addSubcommand((s) => s.setName('manage').setDescription('Manage your server\'s Wren subscription'))
      .addSubcommand((s) => s.setName('mcp').setDescription('Generate an MCP API key and connection instructions'))
      .addSubcommandGroup((g) =>
        g.setName('voice').setDescription('Manage Wren\'s voice channel presence')
          .addSubcommand((s) => s.setName('join').setDescription('Command Wren to join your current voice channel'))
          .addSubcommand((s) => s.setName('leave').setDescription('Command Wren to leave the voice channel'))
      ),
  ].map((c) => c.toJSON());
}

export async function registerCommandsGlobally(client) {
  const cfg = loadConfig();
  const rest = new REST({ version: '10' }).setToken(cfg.discordToken);
  const body = buildCommandTree();
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body });
  } catch (err) {
    console.warn('[registerCommands] Failed to register global commands:', err.message);
  }
}

export async function syncAllGuilds(client) {
  // Register globally for all new and existing guilds
  await registerCommandsGlobally(client);

  // Clean up any legacy guild-specific commands to prevent "doubled" commands
  const cfg = loadConfig();
  const rest = new REST({ version: '10' }).setToken(cfg.discordToken);
  for (const guild of client.guilds.cache.values()) {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: [] });
    } catch (e) {
      // Ignore if we lack access
    }
  }
}
