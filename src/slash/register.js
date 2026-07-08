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
        g.setName('sources').setDescription('Manage knowledge sources (channels, websites, documents)')
          .addSubcommand((s) => s.setName('list').setDescription('List this server’s knowledge sources'))
          .addSubcommand((s) =>
            s.setName('add').setDescription('Add a knowledge source Wren will learn from')
              .addStringOption((o) => o.setName('kind').setDescription('Source type: a Discord channel, a website, or an uploaded document').setRequired(true).addChoices({ name: 'channel', value: 'discord_channel' }, { name: 'website', value: 'website' }, { name: 'document', value: 'manual_doc' }))
              .addChannelOption((o) => o.setName('channel').setDescription('The channel to learn from (for kind: channel)').setRequired(false))
              .addStringOption((o) => o.setName('ref').setDescription('Website URL or document filename (for kind: website/document)').setRequired(false))
              .addStringOption((o) => o.setName('label').setDescription('Friendly name shown in lists and citations').setRequired(false)))
          .addSubcommand((s) => s.setName('remove').setDescription('Remove a knowledge source')
            .addStringOption((o) => o.setName('kind').setDescription('Source type: channel, website, or document').setRequired(true).addChoices({ name: 'channel', value: 'discord_channel' }, { name: 'website', value: 'website' }, { name: 'document', value: 'manual_doc' }))
            .addStringOption((o) => o.setName('ref').setDescription('Which source — start typing to pick from your existing sources').setRequired(true).setAutocomplete(true)))
          .addSubcommand((s) => s.setName('toggle').setDescription('Enable or disable a knowledge source without removing it')
            .addStringOption((o) => o.setName('kind').setDescription('Source type: channel, website, or document').setRequired(true).addChoices({ name: 'channel', value: 'discord_channel' }, { name: 'website', value: 'website' }, { name: 'document', value: 'manual_doc' }))
            .addStringOption((o) => o.setName('ref').setDescription('Which source — start typing to pick from your existing sources').setRequired(true).setAutocomplete(true))
            .addBooleanOption((o) => o.setName('enabled').setDescription('True to enable the source, false to disable it').setRequired(true))))
      .addSubcommandGroup((g) =>
        g.setName('bans').setDescription('Manage who is blocked from talking to Wren')
          .addSubcommand((s) => s.setName('list').setDescription('List users blocked from using Wren'))
          .addSubcommand((s) => s.setName('add').setDescription('Block a user from talking to Wren').addUserOption((o) => o.setName('target').setDescription('The user to block').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Why this user is being blocked (shown in the ban list)').setRequired(false)))
          .addSubcommand((s) => s.setName('remove').setDescription('Unblock a user').addUserOption((o) => o.setName('target').setDescription('The user to unblock').setRequired(true))))
      .addSubcommandGroup((g) =>
        g.setName('memory').setDescription('Manage what Wren remembers long-term')
          .addSubcommand((s) => s.setName('list').setDescription('List saved memories (leadership only)'))
          .addSubcommand((s) => s.setName('add').setDescription('Save a memory for Wren to remember').addStringOption((o) => o.setName('scope').setDescription('server: everyone benefits (leadership only) · user: just about you').setRequired(true).addChoices({ name: 'server', value: 'server' }, { name: 'user', value: 'user' })).addStringOption((o) => o.setName('content').setDescription('What Wren should remember').setRequired(true)))
          .addSubcommand((s) => s.setName('remove').setDescription('Delete a memory by its id (see /wren memory list)').addIntegerOption((o) => o.setName('id').setDescription('The memory id from /wren memory list').setRequired(true))))
      .addSubcommandGroup((g) =>
        g.setName('ingest').setDescription('Run or check knowledge-base ingestion')
          .addSubcommand((s) =>
            s.setName('run').setDescription('Index your knowledge sources now so Wren can use them')
              .addStringOption((o) => o.setName('kind').setDescription('Which sources to index (default: all)').setRequired(false)
                .addChoices({ name: 'all', value: 'all' }, { name: 'channels', value: 'channels' }, { name: 'websites', value: 'websites' }, { name: 'documents', value: 'documents' })))
          .addSubcommand((s) => s.setName('status').setDescription('See when each source was last indexed'))
      )
      .addSubcommand((s) => s.setName('setup').setDescription('Initialise Wren for this server'))
      .addSubcommand((s) =>
        s.setName('upgrade').setDescription('Upgrade your server\'s Wren plan')
          .addStringOption((o) => o.setName('plan').setDescription('The plan to upgrade to').setRequired(true).addChoices({ name: 'Core ($10/mo - 1k messages)', value: 'core' }, { name: 'Pro ($25/mo - 5k messages)', value: 'pro' }))
      )
      .addSubcommand((s) => s.setName('usage').setDescription('Check your current billing cycle usage'))
      .addSubcommand((s) => s.setName('manage').setDescription('Manage your server\'s Wren subscription'))
      .addSubcommand((s) => s.setName('mcp').setDescription('Get an MCP API key for AI agents (regenerating invalidates the old key)'))
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
