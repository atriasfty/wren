import { resolveTenantById } from '../tenant/resolve.js';
import { listTenants } from '../tenant/store.js';
import { runAssistantPipeline } from '../ai/pipeline.js';
import { loadConfig } from '../config.js';
import { executeTool } from '../ai/executor.js';
import { findPlayer } from '../integrations/prc.js';

const HANDLE_PREFIX_RE = /^:\s*pm\s+/i;

// In-game PMs are capped; cut at a word boundary with a visible ellipsis so a
// truncated reply never ends mid-word and the player can tell it was cut.
const MAX_PM_LEN = 500;
export function truncatePm(text, limit = MAX_PM_LEN) {
  if (!text || text.length <= limit) return text;
  let cut = text.lastIndexOf(' ', limit - 1);
  if (cut < limit * 0.6) cut = limit - 1;
  return `${text.slice(0, cut).trimEnd()}…`;
}

// Per-tenant last-polled timestamp to avoid cross-tenant timestamp bleed.
// Exported (like playerSessions below) so tests can reset it between cases.
export const lastPollTs = new Map();

// Per-player conversational history for in-game PMs (multi-turn bridge session state)
export const playerSessions = new Map(); // key: `${tenantId}:${playerName}`, value: { messages: [], lastActive: Date.now() }
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function pollModcallsFor(tenantCtx) {
  const sinceTs = lastPollTs.get(tenantCtx.tenantId) || 0;
  const modcalls = await (await import('../integrations/prc.js')).getModcalls(tenantCtx, { sinceTs });
  if (!modcalls.length) return;

  const botHandle = (tenantCtx.tenant.inGameHandle || ':pm wren').toLowerCase();
  const botName = botHandle.replace(HANDLE_PREFIX_RE, '').trim();

  // Only advance the cursor past modcalls we actually finished handling
  // (successfully, or because they weren't for us). A modcall left unhandled
  // by a thrown error must stay at/after `sinceTs` so the next sweep retries
  // it — the old behavior advanced the cursor past every modcall in the batch
  // up front, so a single transient failure silently dropped that player's
  // request forever. If anything in this batch fails, the cursor stops right
  // before the EARLIEST failure — even if a later, independent modcall in the
  // same batch already succeeded (that one just gets harmlessly reprocessed
  // next sweep, which beats losing the failed one forever).
  let maxHandledTs = sinceTs;
  let firstFailureTs = null;

  for (const m of modcalls) {
    const ts = m.timestamp || 0;
    const text = (m.message || m.content || '').trim();
    if (!text) { maxHandledTs = Math.max(maxHandledTs, ts); continue; }

    // Strip the leading PM command if present to get the target and message
    const cleanText = text.replace(HANDLE_PREFIX_RE, '').trim();

    // Check if the message is directed to the bot. The name must be followed
    // by whitespace or end-of-string — a bare startsWith would hijack PMs to
    // players whose names merely begin with the bot's name (":pm wrenathan hi").
    const lowerClean = cleanText.toLowerCase();
    const addressedToBot = lowerClean === botName ||
      (lowerClean.startsWith(botName) && /\s/.test(cleanText.charAt(botName.length)));
    if (!addressedToBot) { maxHandledTs = Math.max(maxHandledTs, ts); continue; }

    const playerName = m.callerName || m.playerName;
    if (!playerName) { maxHandledTs = Math.max(maxHandledTs, ts); continue; }

    // Extract the actual question by removing the bot's name/handle
    const question = cleanText.slice(botName.length).trim();
    if (!question) { maxHandledTs = Math.max(maxHandledTs, ts); continue; }

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
            { username: playerName, message: truncatePm(result.text) },
            { kind: 'system' },
          );
        } catch (err) {
          console.warn('[ingame] send_pm failed:', err.message);
        }
      }
      maxHandledTs = Math.max(maxHandledTs, ts);
    } catch (err) {
      console.error(`[ingame] failed to process modcall from ${playerName}:`, err.message);
      firstFailureTs = firstFailureTs === null ? ts : Math.min(firstFailureTs, ts);
      // Let the player know rather than leaving them with silence; best-effort
      // and doesn't block the retry this modcall gets on the next sweep.
      try {
        await executeTool(
          tenantCtx,
          'send_pm',
          { username: playerName, message: 'Sorry, something went wrong processing your request. Please try again.' },
          { kind: 'system' },
        );
      } catch {}
    }
  }

  const cursor = firstFailureTs === null
    ? maxHandledTs
    : Math.max(sinceTs, Math.min(maxHandledTs, firstFailureTs - 1));
  lastPollTs.set(tenantCtx.tenantId, cursor);
}

export function attachIngameBridge(client) {
  // Periodically poll modcalls — pass the encryption key so listTenants can decrypt secrets.
  // The in-flight guard prevents overlapping sweeps when PRC responds slowly.
  let polling = false;
  setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const cfg = loadConfig();
      const tenants = await listTenants(cfg.tenantSecretEncKey);
      for (const t of tenants) {
        // Tenants without an ERLC key can't have modcalls — skip them instead
        // of throwing inside getModcalls on every sweep.
        if (!t.erlcServerKey) continue;
        const ctx = await resolveTenantById(t.tenantId);
        if (!ctx) continue;
        try {
          await pollModcallsFor(ctx);
        } catch (err) {
          console.warn(`[ingame] poll failed for ${t.tenantId}:`, err.message);
        }
      }
    } catch (err) {
      console.warn('[ingame] poll sweep failed:', err.message);
    } finally {
      polling = false;
    }
  }, 30_000);

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
