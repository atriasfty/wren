import { resolveTenantByGuildId } from '../tenant/resolve.js';
import { pushRaidEvent, recentRaidEvents, audit } from '../tenant/store.js';
import { executeTool } from '../ai/executor.js';

const POLL_INTERVAL_MS = 60_000;
const DEFAULT_RULE_WINDOW_MS = 30_000;
const DEFAULT_RULE_THRESHOLD = 6;

let pollers = new Map();

async function pollOnce(client, tenantCtx) {
  try {
    const { getCommandLogs } = await import('../integrations/prc.js');
    const logs = await getCommandLogs(tenantCtx, { limit: 50 });
    const now = Date.now();
    const cutoff = now - DEFAULT_RULE_WINDOW_MS;

    for (const log of logs) {
      const ts = (log.timestamp || 0) * 1000;
      if (ts < cutoff) continue;
      await pushRaidEvent({
        tenantId: tenantCtx.tenantId,
        playerId: log.playerName,
        command: log.command,
        logTs: ts,
      });
    }

    const recent = await recentRaidEvents(tenantCtx.tenantId, DEFAULT_RULE_WINDOW_MS);
    const byPlayer = new Map();
    for (const r of recent) {
      byPlayer.set(r.playerId, (byPlayer.get(r.playerId) || 0) + 1);
    }

    const alertChannelId = tenantCtx.tenant.raidAlertChannel;
    const alertRoleId = tenantCtx.tenant.raidAlertRole;
    if (!alertChannelId) return;

    for (const [player, count] of byPlayer) {
      if (count < DEFAULT_RULE_THRESHOLD) continue;

      const seen = recent.find((r) => r.playerId === player && r.targetCount >= DEFAULT_RULE_THRESHOLD);
      if (seen) continue;

      await pushRaidEvent({
        tenantId: tenantCtx.tenantId,
        playerId: player,
        command: '__raid_alert__',
        logTs: now,
        targetCount: count,
      });

      const channel = await client.channels.fetch(alertChannelId).catch(() => null);
      if (!channel?.isTextBased?.()) continue;

      const mention = alertRoleId ? `<@&${alertRoleId}> ` : '';
      await channel.send({
        content: `${mention}**Raid alert:** \`${player}\` ran ${count} commands in the last ${DEFAULT_RULE_WINDOW_MS / 1000}s.`,
        allowedMentions: { roles: alertRoleId ? [alertRoleId] : [] },
      }).catch(() => {});

      await audit({
        tenantId: tenantCtx.tenantId,
        actor: 'system',
        action: 'raid_alert',
        target: player,
        metadata: { count, windowMs: DEFAULT_RULE_WINDOW_MS },
      });

      if (tenantCtx.tenant.raidAutoPunish) {
        try {
          await executeTool(
            tenantCtx,
            'ban_player',
            { username: player, reason: `Auto-ban: ${count} commands in ${DEFAULT_RULE_WINDOW_MS / 1000}s (raid)`, duration: 60 },
            { kind: 'system' },
          );
        } catch (err) {
          console.warn('[raid] auto-ban failed:', err.message);
        }
      }
    }
  } catch (err) {
    console.warn(`[raid] poll failed for ${tenantCtx.tenantId}:`, err.message);
  }
}

export function attachRaidMonitor(client, tenantCtxList) {
  for (const ctx of tenantCtxList) {
    if (pollers.has(ctx.tenantId)) continue;
    const tick = async () => pollOnce(client, ctx);
    tick();
    const t = setInterval(tick, POLL_INTERVAL_MS);
    pollers.set(ctx.tenantId, t);
  }
}

export function stopAllRaidPollers() {
  for (const t of pollers.values()) clearInterval(t);
  pollers.clear();
}
