import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { loadConfig } from '../config.js';
import { listTenants } from '../tenant/store.js';

function buildCommandTree() {
  return [
    new SlashCommandBuilder()
      .setName('wren')
      .setDescription('Wren bot configuration and utilities')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommandGroup((g) =>
        g.setName('config').setDescription('View or change server configuration').addSubcommand((s) => s.setName('view').setDescription('Show all current config'))
          .addSubcommand((s) => s.setName('set').setDescription('Set a freeform config value').addStringOption((o) => o.setName('key').setDescription('Config key').setRequired(true)).addStringOption((o) => o.setName('value').setDescription('Config value').setRequired(true)))
          .addSubcommand((s) => s.setName('core-info').setDescription('Set the core info block for the bot prompt').addStringOption((o) => o.setName('text').setDescription('Markdown text').setRequired(true)))
          .addSubcommand((s) => s.setName('response-style').setDescription('Set response style guidance').addStringOption((o) => o.setName('text').setDescription('Markdown text').setRequired(true)))
          .addSubcommand((s) => s.setName('bot-name').setDescription('Rename the bot for this server').addStringOption((o) => o.setName('name').setDescription('Display name').setRequired(true)))
          .addSubcommand((s) => s.setName('in-game-handle').setDescription('Set the in-game PM handle').addStringOption((o) => o.setName('handle').setDescription('e.g. ":pm wren"').setRequired(true)))
          .addSubcommand((s) => s.setName('raid-auto-punish').setDescription('Toggle auto-punish for raid detection').addBooleanOption((o) => o.setName('enabled').setDescription('Enable?').setRequired(true)))
          .addSubcommand((s) => s.setName('status-channel').setDescription('Set the status channel').addChannelOption((o) => o.setName('channel').setDescription('Text channel').setRequired(true)))
          .addSubcommand((s) => s.setName('erlc-log-channel').setDescription('Set the ERLC command-log channel').addChannelOption((o) => o.setName('channel').setDescription('Text channel').setRequired(true)))
          .addSubcommand((s) => s.setName('ticket-category').setDescription('Set the ticket parent category').addChannelOption((o) => o.setName('category').setDescription('Category').setRequired(true)))
          .addSubcommand((s) => s.setName('security-role').setDescription('Set the role used to gate Discord channel listing').addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
          .addSubcommand((s) => s.setName('raid-alert').setDescription('Set raid alert channel and role').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Role to ping').setRequired(false))),
      )
      .addSubcommandGroup((g) =>
        g.setName('sources').setDescription('Manage sources of truth (channels, websites, docs)').addSubcommand((s) => s.setName('list').setDescription('List configured sources'))
          .addSubcommand((s) =>
            s.setName('add').setDescription('Add a source').addStringOption((o) => o.setName('kind').setDescription('Source kind').setRequired(true).addChoices({ name: 'channel', value: 'discord_channel' }, { name: 'website', value: 'website' }, { name: 'document', value: 'manual_doc' }))
              .addStringOption((o) => o.setName('ref').setDescription('Channel ID, URL, or doc filename').setRequired(true))
              .addStringOption((o) => o.setName('label').setDescription('Label').setRequired(false))
              .addNumberOption((o) => o.setName('weight').setDescription('Retrieval weight (0–2)').setRequired(false).setMinValue(0).setMaxValue(2)))
          .addSubcommand((s) => s.setName('remove').setDescription('Remove a source').addStringOption((o) => o.setName('kind').setDescription('Kind').setRequired(true).addChoices({ name: 'channel', value: 'discord_channel' }, { name: 'website', value: 'website' }, { name: 'document', value: 'manual_doc' })).addStringOption((o) => o.setName('ref').setDescription('Channel ID, URL, or filename').setRequired(true)))
          .addSubcommand((s) => s.setName('toggle').setDescription('Enable/disable a source').addStringOption((o) => o.setName('kind').setDescription('Kind').setRequired(true).addChoices({ name: 'channel', value: 'discord_channel' }, { name: 'website', value: 'website' }, { name: 'document', value: 'manual_doc' })).addStringOption((o) => o.setName('ref').setDescription('Channel ID, URL, or filename').setRequired(true)).addBooleanOption((o) => o.setName('enabled').setDescription('Enabled?').setRequired(true))))
      .addSubcommandGroup((g) =>
        g.setName('policy').setDescription('Manage tool permission policy').addSubcommand((s) => s.setName('view').setDescription('Show the current policy'))
          .addSubcommand((s) => s.setName('set').setDescription('Set minimum role for a tool').addStringOption((o) => o.setName('tool').setDescription('Tool name').setRequired(true)).addStringOption((o) => o.setName('min-role').setDescription('Minimum role').setRequired(true).addChoices({ name: 'owner', value: 'owner' }, { name: 'admin', value: 'admin' }, { name: 'mod', value: 'mod' }, { name: 'staff', value: 'staff' }, { name: 'user', value: 'user' }))))
      .addSubcommandGroup((g) =>
        g.setName('roles').setDescription('Manage role slots').addSubcommand((s) => s.setName('view').setDescription('Show role slots'))
          .addSubcommand((s) => s.setName('set').setDescription('Set a role slot').addStringOption((o) => o.setName('slot').setDescription('Slot').setRequired(true).addChoices({ name: 'whitelist', value: 'whitelist' }, { name: 'booster', value: 'booster' }, { name: 'la_plus', value: 'la_plus' }, { name: 'la_premium', value: 'la_premium' }, { name: 'staff_a', value: 'staff_a' }, { name: 'staff_b', value: 'staff_b' }, { name: 'staff_c', value: 'staff_c' }, { name: 'staff', value: 'staff' })).addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))))
      .addSubcommandGroup((g) =>
        g.setName('bans').setDescription('Manage the Wren ban list').addSubcommand((s) => s.setName('list').setDescription('List bans'))
          .addSubcommand((s) => s.setName('add').setDescription('Ban a user').addUserOption((o) => o.setName('target').setDescription('User').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false)))
          .addSubcommand((s) => s.setName('remove').setDescription('Unban a user').addUserOption((o) => o.setName('target').setDescription('User').setRequired(true))))
      .addSubcommandGroup((g) =>
        g.setName('memory').setDescription('Manage long-term memory').addSubcommand((s) => s.setName('list').setDescription('List memories'))
          .addSubcommand((s) => s.setName('add').setDescription('Add a memory').addStringOption((o) => o.setName('scope').setDescription('Scope').setRequired(true).addChoices({ name: 'server', value: 'server' }, { name: 'user', value: 'user' })).addStringOption((o) => o.setName('content').setDescription('Content').setRequired(true)))
          .addSubcommand((s) => s.setName('remove').setDescription('Remove a memory by id').addIntegerOption((o) => o.setName('id').setDescription('Memory id').setRequired(true))))
      .addSubcommandGroup((g) =>
        g.setName('ingest').setDescription('Run or check knowledge-base ingestion').addSubcommand((s) => s.setName('run').setDescription('Run ingestion for this server').addStringOption((o) => o.setName('kind').setDescription('What to ingest').setRequired(false).addChoices({ name: 'all', value: 'all' }, { name: 'channels', value: 'channels' }, { name: 'websites', value: 'websites' }, { name: 'documents', value: 'documents' }))))
          .addSubcommand((s) => s.setName('status').setDescription('Show ingestion status')))
      .addSubcommand((s) => s.setName('setup').setDescription('Create a tenant row for this server (no-op if already created)')),
  ].map((c) => c.toJSON());
}

export async function registerCommandsForGuild(client, guildId) {
  const cfg = loadConfig();
  const rest = new REST({ version: '10' }).setToken(cfg.discordToken);
  const body = buildCommandTree();
  await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body });
}

export async function registerCommandsGlobally(client) {
  const cfg = loadConfig();
  const rest = new REST({ version: '10' }).setToken(cfg.discordToken);
  const body = buildCommandTree();
  await rest.put(Routes.applicationCommands(client.user.id), { body });
}

export async function syncAllGuilds(client) {
  const tenants = await listTenants();
  const known = new Set(tenants.map((t) => t.tenantId));
  for (const [guildId, guild] of client.guilds.cache) {
    if (known.has(guildId)) {
      await registerCommandsForGuild(client, guildId);
    }
  }
}
