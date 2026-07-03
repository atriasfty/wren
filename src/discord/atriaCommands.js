import { query } from '../db/pool.js';
import { resolveTenantByGuildId } from '../tenant/resolve.js';
import { issueApiToken } from '../tenant/store.js';
import { hashToken, generateApiToken } from '../tenant/crypto.js';
import { EmbedBuilder } from 'discord.js';

// Original hardcoded staff list (pre-dates ATRIA_STAFF_IDS). Kept as a
// built-in default so deployments that never configured the env var don't
// silently lose all $atria access -- ATRIA_STAFF_IDS only adds to this set,
// it never replaces it.
const DEFAULT_STAFF_IDS = ['753552148167524422', '553071305482829835'];

// Read lazily from env (not loadConfig) so importing this module has no side
// effects and doesn't require the full config to be present (e.g. in tests).
function atriaStaffIds() {
  const fromEnv = (process.env.ATRIA_STAFF_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return new Set([...DEFAULT_STAFF_IDS, ...fromEnv]);
}

// In-memory store for pending confirmations
const pendingCommands = new Map();
const CONFIRM_TTL_MS = 60_000;

// Exported (not just used internally) so it's directly fuzz-testable as a
// pure parsing function, independent of today's call sites always passing a
// string.
export function parseDurationMs(durationStr) {
  if (typeof durationStr !== 'string' || !durationStr) return null;
  const d = durationStr.toLowerCase();
  let ms = null;
  if (d.endsWith('d')) ms = parseInt(d, 10) * 24 * 60 * 60 * 1000;
  else if (d.endsWith('w')) ms = parseInt(d, 10) * 7 * 24 * 60 * 60 * 1000;
  else if (d.endsWith('m')) ms = parseInt(d, 10) * 30 * 24 * 60 * 60 * 1000;
  // parseInt on a huge numeric string, or a string with no leading digits at
  // all ("d" alone -> NaN), must not silently become an unusable duration
  // (e.g. an Invalid Date ban expiry) instead of a clean "invalid format".
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms;
}

export async function handleAtriaCommands(message) {
  if (!atriaStaffIds().has(message.author.id)) return false;
  
  const content = message.content.trim();
  if (!content.startsWith('$atria')) return false;

  // This handles both "$atria globalban" and "$atriaglobalban"
  const args = content.slice(6).trim().split(/\s+/).filter(Boolean);
  if (args.length === 0) return true;

  const command = args[0].toLowerCase();
  
  try {
    if (command === 'confirm') {
      const pending = pendingCommands.get(message.author.id);
      if (pending && Date.now() <= pending.expiresAt) {
        pendingCommands.delete(message.author.id);
        await pending.execute();
      } else {
        pendingCommands.delete(message.author.id);
        await message.reply(pending ? 'That pending command expired. Re-run it and confirm within 60 seconds.' : 'No pending command to confirm.');
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
            { name: 'Usage', value: `${t.monthlyMessageCount || 0} msgs, ${Math.round((t.monthlyVoiceTimeSeconds || 0) / 60)} voice mins`, inline: true },
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
      } else if (action === 'give') {
        if (!targetId) {
          await message.reply('Missing user ID.');
          return true;
        }
        execute = async () => {
          await query('INSERT INTO user_agreements (discord_id) VALUES ($1) ON CONFLICT DO NOTHING', [targetId]);
          await message.reply(`Manually marked user ID ${targetId} as having consented to ToS.`);
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
        const res = await query("SELECT tenant_id, status_channel_id, last_active_channel_id FROM tenants WHERE (status_channel_id IS NOT NULL AND status_channel_id != '') OR (last_active_channel_id IS NOT NULL AND last_active_channel_id != '')");
        let sent = 0;
        let failed = 0;
        for (const row of res.rows) {
          try {
            const targetChannelId = (row.status_channel_id && row.status_channel_id !== '') ? row.status_channel_id : row.last_active_channel_id;
            const channel = await message.client.channels.fetch(targetChannelId);
            await channel.send(`**ATRIA PLATFORM BROADCAST:**\n${msg}`);
            sent++;
          } catch (e) {
            console.error(`[broadcast error] tenant ${row.tenant_id} channel ${row.status_channel_id}:`, e.message);
            failed++;
          }
        }
        await message.reply(`Broadcast sent to ${sent} servers. (Failed: ${failed})`);
      };
    } else if (command === 'wipe') {
      const type = args[1]?.toLowerCase();
      const targetId = args[2];
      
      if (!type || !targetId) {
        await message.reply('Usage: `$atria wipe <server|user> <id>`');
        return true;
      }
      
      if (type === 'server') {
        execute = async () => {
          const res = await query('DELETE FROM tenants WHERE tenant_id = $1 RETURNING *', [targetId]);
          if (res.rowCount > 0) {
            await message.reply(`Server ${targetId} and all associated data have been wiped.`);
          } else {
            await message.reply(`Server ${targetId} not found.`);
          }
        };
      } else if (type === 'user') {
        execute = async () => {
          await query('DELETE FROM user_agreements WHERE discord_id = $1', [targetId]);
          await query('DELETE FROM tenant_memory WHERE user_key = $1', [`discord:${targetId}`]);
          await query('DELETE FROM user_mcp_tokens WHERE discord_id = $1', [targetId]);
          await query('DELETE FROM audit_log WHERE actor = $1 OR target = $1', [`discord:${targetId}`]);
          await query('DELETE FROM global_state WHERE key = $1', [`bypass:${targetId}`]);
          await message.reply(`User ${targetId}'s ToS agreement, MCP tokens, audit logs, and memories have been wiped. Bans were retained.`);
        };
      } else {
        await message.reply('Invalid wipe type. Use "server" or "user".');
        return true;
      }
    } else if (command === 'bypass') {
      const targetServerId = args[1];
      if (!targetServerId) {
        await message.reply('Usage: `$atria bypass <server_id>`');
        return true;
      }
      execute = async () => {
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        const value = { tenantId: targetServerId, expiresAt };
        await query("INSERT INTO global_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", [`bypass:${message.author.id}`, JSON.stringify(value)]);
        await message.reply(`Bypass granted for server **${targetServerId}** for 15 minutes. You can now use \`/wren config\` in that server.`);
      };
    } else if (command === 'apitoken') {
      const serverId = args[1] || message.guild?.id;
      const label = args.slice(2).join(' ') || null;
      if (!serverId) {
        await message.reply('Usage: `$atria apitoken <server_id> [label]`');
        return true;
      }
      execute = async () => {
        const tenantCtx = await resolveTenantByGuildId(serverId);
        if (!tenantCtx) {
          await message.reply(`Server ${serverId} is not configured with Wren.`);
          return;
        }
        const rawToken = generateApiToken();
        await issueApiToken({ tenantId: tenantCtx.tenantId, tokenHash: hashToken(rawToken), label, scopes: ['chat'] });
        try {
          await message.author.send(`API token for server **${serverId}**${label ? ` (${label})` : ''} — scope \`chat\`:\n\`\`\`${rawToken}\`\`\`\nThis is shown once; store it securely.`);
          await message.reply('API token created — sent to your DMs.');
        } catch {
          await message.reply('API token created, but I could not DM you. Enable DMs and re-run.');
        }
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
      pendingCommands.set(message.author.id, { execute, expiresAt: Date.now() + CONFIRM_TTL_MS, description: content });
      await message.reply(`Got it, confirm? (Type \`$atria confirm\` within 60s to execute: \`${content.slice(0, 180)}\`)`);
    }
    return true;

  } catch (err) {
    console.error('[$atria command error]', err);
    // Never let a failure to report the failure (missing permissions, a
    // deleted channel/message, a Discord API hiccup) escape as an unhandled
    // rejection — messageHandler.js awaits this with no try/catch of its
    // own, and an unhandled rejection there crashes the whole process.
    try { await message.reply(`Error executing command: ${err.message}`); } catch {}
    return true;
  }
}
