import { query } from '../db/pool.js';
import { resolveTenantByGuildId } from '../tenant/resolve.js';
import { EmbedBuilder } from 'discord.js';

const ATRIA_STAFF_IDS = new Set(['753552148167524422', '553071305482829835']);

// In-memory store for pending confirmations
const pendingCommands = new Map();

function parseDurationMs(durationStr) {
  if (!durationStr) return null;
  const d = durationStr.toLowerCase();
  if (d.endsWith('d')) return parseInt(d) * 24 * 60 * 60 * 1000;
  if (d.endsWith('w')) return parseInt(d) * 7 * 24 * 60 * 60 * 1000;
  if (d.endsWith('m')) return parseInt(d) * 30 * 24 * 60 * 60 * 1000;
  return null;
}

export async function handleAtriaCommands(message) {
  if (!ATRIA_STAFF_IDS.has(message.author.id)) return false;
  
  const content = message.content.trim();
  if (!content.startsWith('$atria')) return false;

  // This handles both "$atria globalban" and "$atriaglobalban"
  const args = content.slice(6).trim().split(/\s+/).filter(Boolean);
  if (args.length === 0) return true;

  const command = args[0].toLowerCase();
  
  try {
    if (command === 'confirm') {
      const pending = pendingCommands.get(message.author.id);
      if (pending) {
        pendingCommands.delete(message.author.id);
        await pending();
      } else {
        await message.reply('No pending command to confirm.');
      }
      return true;
    }

    let execute = null;

    if (command === 'serverinfo') {
      execute = async () => {
        if (!message.guild) {
          await message.reply('This command must be run in a server.');
          return;
        }
        const tenantCtx = await resolveTenantByGuildId(message.guild.id);
        if (!tenantCtx) {
          await message.reply('This server is not configured with Wren.');
          return;
        }
        
        const t = tenantCtx.tenant;
        const embed = new EmbedBuilder()
          .setTitle('Atria Server Info')
          .setColor('#8a2be2')
          .addFields(
            { name: 'Tenant ID', value: t.tenantId, inline: true },
            { name: 'Display Name', value: t.displayName, inline: true },
            { name: 'Owner', value: t.ownerDiscordId ? `<@${t.ownerDiscordId}>` : 'None', inline: true },
            { name: 'Plan', value: t.subscriptionTier || 'free', inline: true },
            { name: 'Usage', value: `${t.monthlyMessageCount || 0} msgs this cycle`, inline: true },
            { name: 'Cycle Reset', value: t.billingCycleReset ? new Date(t.billingCycleReset).toLocaleString() : 'N/A', inline: true }
          );
        
        await message.reply({ embeds: [embed] });
      };
    } else if (command === 'billing') {
      const subcmd = args[1]?.toLowerCase();
      
      if (subcmd === 'upgrade') {
        const tier = args[2]?.toLowerCase();
        const duration = args[3]?.toLowerCase();
        
        if (!['core', 'pro'].includes(tier)) {
          await message.reply('Invalid tier. Use "core" or "pro".');
          return true;
        }
        if (!duration) {
          await message.reply('Missing duration (e.g. 1d, 2w, 1m).');
          return true;
        }

        const addedMs = parseDurationMs(duration);
        if (!addedMs) {
          await message.reply('Invalid duration format. Use d, w, or m.');
          return true;
        }

        execute = async () => {
          if (!message.guild) {
            await message.reply('Must be run in a server.'); return;
          }
          const tenantCtx = await resolveTenantByGuildId(message.guild.id);
          if (!tenantCtx) {
            await message.reply('Not configured.'); return;
          }
          const newReset = new Date(Date.now() + addedMs);
          await query('UPDATE tenants SET subscription_tier = $1, billing_cycle_reset = $2 WHERE tenant_id = $3', [tier, newReset.toISOString(), tenantCtx.tenantId]);
          await message.reply(`Server upgraded to **${tier}** until **${newReset.toLocaleString()}**.`);
        };
      } else if (subcmd === 'downgrade') {
        execute = async () => {
          if (!message.guild) {
            await message.reply('Must be run in a server.'); return;
          }
          const tenantCtx = await resolveTenantByGuildId(message.guild.id);
          if (!tenantCtx) {
            await message.reply('Not configured.'); return;
          }
          await query('UPDATE tenants SET subscription_tier = $1 WHERE tenant_id = $2', ['free', tenantCtx.tenantId]);
          await message.reply('Server downgraded to **free**.');
        };
      } else {
        await message.reply('Invalid billing subcommand. Use "upgrade <core|pro> <duration>" or "downgrade".');
        return true;
      }
    } else if (command === 'consent') {
      const action = args[1]?.toLowerCase();
      const targetId = args[2];
      
      if (action === 'revoke') {
        if (!targetId) {
          await message.reply('Missing user ID.');
          return true;
        }
        execute = async () => {
          const res = await query('DELETE FROM user_agreements WHERE discord_id = $1 RETURNING *', [targetId]);
          if (res.rowCount > 0) {
            await message.reply(`Revoked ToS consent for user ID ${targetId}.`);
          } else {
            await message.reply(`User ID ${targetId} was not in the consent database.`);
          }
        };
      } else {
        const checkTargetId = args[1];
        if (!checkTargetId) {
          await message.reply('Missing user ID.');
          return true;
        }
        execute = async () => {
          const res = await query('SELECT agreed_at FROM user_agreements WHERE discord_id = $1', [checkTargetId]);
          if (res.rows.length > 0) {
            await message.reply(`✅ User ID ${checkTargetId} agreed to ToS at ${new Date(res.rows[0].agreed_at).toLocaleString()}`);
          } else {
            await message.reply(`❌ User ID ${checkTargetId} has NOT agreed to the ToS.`);
          }
        };
      }
    } else if (command === 'globalban') {
      const targetId = args[1];
      if (!targetId) {
        await message.reply('Missing user ID.');
        return true;
      }
      const duration = args[2];
      const ms = parseDurationMs(duration);
      const expires = ms ? new Date(Date.now() + ms).toISOString() : null;
      
      execute = async () => {
        await query('INSERT INTO global_bans (discord_id, expires_at) VALUES ($1, $2) ON CONFLICT (discord_id) DO UPDATE SET expires_at = $2', [targetId, expires]);
        await message.reply(`User ${targetId} has been globally banned ${expires ? `until ${new Date(expires).toLocaleString()}` : 'permanently'}.`);
      };
    } else if (command === 'globalunban') {
      const targetId = args[1];
      if (!targetId) {
        await message.reply('Missing user ID.');
        return true;
      }
      execute = async () => {
        await query('DELETE FROM global_bans WHERE discord_id = $1', [targetId]);
        await message.reply(`User ${targetId} has been globally unbanned.`);
      };
    } else if (command === 'leave') {
      const serverId = args[1] || message.guild?.id;
      if (!serverId) {
        await message.reply('Missing server ID and not run in a server.');
        return true;
      }
      execute = async () => {
        const guild = message.client.guilds.cache.get(serverId);
        if (guild) {
          await guild.leave();
          await message.reply(`Left server ${serverId}.`);
        } else {
          await message.reply(`Server ${serverId} not found in cache. Ensure I am in it.`);
        }
      };
    } else if (command === 'resetusage') {
      const serverId = args[1] || message.guild?.id;
      if (!serverId) {
        await message.reply('Missing server ID and not run in a server.');
        return true;
      }
      execute = async () => {
        const tenantCtx = await resolveTenantByGuildId(serverId);
        if (!tenantCtx) {
          await message.reply(`Server ${serverId} is not configured with Wren.`);
          return;
        }
        await query('UPDATE tenants SET monthly_message_count = 0 WHERE tenant_id = $1', [tenantCtx.tenantId]);
        await message.reply(`Usage reset to 0 for server ${serverId}.`);
      };
    } else if (command === 'broadcast') {
      const msg = args.slice(1).join(' ');
      if (!msg) {
        await message.reply('Missing broadcast message.');
        return true;
      }
      execute = async () => {
        const res = await query("SELECT tenant_id, status_channel_id, security_role_id FROM tenants WHERE status_channel_id IS NOT NULL");
        let sent = 0;
        for (const row of res.rows) {
          try {
            const channel = await message.client.channels.fetch(row.status_channel_id);
            const ping = row.security_role_id ? `<@&${row.security_role_id}> ` : '';
            await channel.send(`${ping}**ATRIA PLATFORM BROADCAST:**\n${msg}`);
            sent++;
          } catch (e) {}
        }
        await message.reply(`Broadcast sent to ${sent} servers.`);
      };
    } else if (command === 'pause') {
      execute = async () => {
        await query("INSERT INTO global_state (key, value) VALUES ('paused', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify({ paused: true })]);
        await message.reply(`Global pause is now **ON**.`);
      };
    } else if (command === 'unpause') {
      execute = async () => {
        await query("INSERT INTO global_state (key, value) VALUES ('paused', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify({ paused: false })]);
        await message.reply(`Global pause is now **OFF**.`);
      };
    } else {
      await message.reply('Unknown $atria command.');
      return true;
    }

    if (execute) {
      pendingCommands.set(message.author.id, execute);
      await message.reply('Got it, confirm? (Type `$atria confirm` to execute)');
    }
    return true;

  } catch (err) {
    console.error('[$atria command error]', err);
    await message.reply(`Error executing command: ${err.message}`);
    return true;
  }
}
