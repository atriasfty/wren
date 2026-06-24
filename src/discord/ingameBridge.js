import { resolveTenantById } from '../tenant/resolve.js';
import { listTenants } from '../tenant/store.js';
import { runAssistantPipeline } from '../ai/pipeline.js';
import { executeTool } from '../ai/executor.js';
import { findPlayer } from '../integrations/prc.js';

const HANDLE_PREFIX_RE = /^:\s*pm\s+/i;

// Per-tenant last-polled timestamp to avoid cross-tenant timestamp bleed.
const lastPollTs = new Map();

// Per-player conversational history for in-game PMs (multi-turn bridge session state)
export const playerSessions = new Map(); // key: `${tenantId}:${playerName}`, value: { messages: [], lastActive: Date.now() }
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

    // Retrieve or initialize session state
    const sessionKey = `${tenantCtx.tenantId}:${playerName.toLowerCase()}`;
    const now = Date.now();
    let session = playerSessions.get(sessionKey);
    if (!session || (now - session.lastActive > SESSION_TTL_MS)) {
      session = { messages: [], lastActive: now };
      playerSessions.set(sessionKey, session);
    }
    session.lastActive = now;

    try {
      const online = await findPlayer(tenantCtx, playerName).catch(() => null);
      const actor = { kind: 'in_game', playerName, isStaff: online?.permission === 'Server Moderator' || online?.permission === 'Server Administrator' };

      const result = await runAssistantPipeline(tenantCtx, {
        question,
        actor,
        isInGame: true,
        history: [...session.messages],
      });

      if (result.text) {
        // Update session history
        session.messages.push({ role: 'user', content: question });
        session.messages.push({ role: 'assistant', content: result.text });

        // Cap history to 6 turns (12 messages)
        if (session.messages.length > 12) {
          session.messages = session.messages.slice(-12);
        }

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
  // Periodically poll modcalls
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

  // Periodically clean up expired player sessions
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of playerSessions.entries()) {
      if (now - value.lastActive > SESSION_TTL_MS) {
        playerSessions.delete(key);
      }
    }
  }, 60_000);
}
