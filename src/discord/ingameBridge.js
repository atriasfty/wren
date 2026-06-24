import { resolveTenantById } from '../tenant/resolve.js';
import { listTenants } from '../tenant/store.js';
import { runAssistantPipeline } from '../ai/pipeline.js';
import { executeTool } from '../ai/executor.js';
import { findPlayer } from '../integrations/prc.js';

const HANDLE_PREFIX_RE = /^:\s*pm\s+/i;

// Per-tenant last-polled timestamp to avoid cross-tenant timestamp bleed.
const lastPollTs = new Map();

export async function pollModcallsFor(tenantCtx) {
  const sinceTs = lastPollTs.get(tenantCtx.tenantId) || 0;
  const modcalls = await (await import('../integrations/prc.js')).getModcalls(tenantCtx, { sinceTs });
  if (!modcalls.length) return;
  lastPollTs.set(
    tenantCtx.tenantId,
    Math.max(...modcalls.map((m) => m.timestamp || 0), sinceTs),
  );

  const botHandle = (tenantCtx.tenant.inGameHandle || ':pm wren').toLowerCase();
  const botName = botHandle.replace(HANDLE_PREFIX_RE, '').trim();

  for (const m of modcalls) {
    const text = (m.message || m.content || '').trim();
    if (!text) continue;

    // Strip the leading PM command if present to get the target and message
    const cleanText = text.replace(HANDLE_PREFIX_RE, '').trim();

    // Check if the message is directed to the bot
    if (!cleanText.toLowerCase().startsWith(botName)) continue;

    const playerName = m.callerName || m.playerName;
    
    // Extract the actual question by removing the bot's name/handle
    const question = cleanText.slice(botName.length).trim();
    if (!question) continue;

    try {
      const online = await findPlayer(tenantCtx, playerName).catch(() => null);
      const actor = { kind: 'in_game', playerName, isStaff: online?.permission === 'Server Moderator' || online?.permission === 'Server Administrator' };

      const result = await runAssistantPipeline(tenantCtx, {
        question,
        actor,
        isInGame: true,
      });

      if (result.text) {
        try {
          await executeTool(
            tenantCtx,
            'send_pm',
            { username: playerName, message: result.text.slice(0, 500) },
            { kind: 'system' },
          );
        } catch (err) {
          console.warn('[ingame] send_pm failed:', err.message);
        }
      }
    } catch (err) {
      console.error(`[ingame] failed to process modcall from ${playerName}:`, err.message);
    }
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function attachIngameBridge(client) {
  setInterval(async () => {
    const tenants = await listTenants();
    for (const t of tenants) {
      const ctx = await resolveTenantById(t.tenantId);
      if (!ctx) continue;
      try {
        await pollModcallsFor(ctx);
      } catch (err) {
        console.warn(`[ingame] poll failed for ${t.tenantId}:`, err.message);
      }
    }
  }, 15_000);
}
