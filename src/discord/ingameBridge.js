import { resolveTenantById } from '../tenant/resolve.js';
import { listTenants } from '../tenant/store.js';
import { runAssistantPipeline } from '../ai/pipeline.js';
import { executeTool } from '../ai/executor.js';
import { findPlayer } from '../integrations/prc.js';

const HANDLE_PREFIX_RE = /^:\s*pm\s+/i;

let _lastPollTs = 0;

async function pollModcallsFor(tenantCtx) {
  const modcalls = await (await import('../integrations/prc.js')).getModcalls(tenantCtx, { sinceTs: _lastPollTs });
  if (!modcalls.length) return;
  _lastPollTs = Math.max(...modcalls.map((m) => m.timestamp || 0), _lastPollTs);

  const botHandle = (tenantCtx.tenant.inGameHandle || ':pm wren').toLowerCase();
  for (const m of modcalls) {
    const text = (m.message || m.content || '').trim();
    if (!text) continue;

    const isHandle = HANDLE_PREFIX_RE.test(text) || text.toLowerCase().startsWith(botHandle);
    if (!isHandle) continue;

    const playerName = m.callerName || m.playerName;
    const question = text.replace(HANDLE_PREFIX_RE, '').replace(new RegExp(`^${escapeRegex(botHandle)}\\s*`, 'i'), '').trim();
    if (!question) continue;

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
