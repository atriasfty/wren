import MistralClient from '@mistralai/mistralai';
import { retrieveSources } from '../rag/retrieve.js';
import { webSearch } from '../integrations/brave.js';
import { executeTool } from './executor.js';
import { buildSystemPrompt } from './prompts.js';
import { loadConfig } from '../config.js';
import { addMemory } from '../tenant/store.js';

let _client = null;
function client() {
  if (!_client) {
    const cfg = loadConfig();
    _client = new MistralClient(cfg.mistralApiKey);
  }
  return _client;
}

const MAX_TOOL_STEPS = 6;
const WEB_TRIGGER = /(?:^|\s)(?:what|who|where|when|why|how|latest|current|today|news|release|update|is|are|do|does)\b/i;

function actorKey(actor) {
  if (!actor) return 'unknown';
  if (actor.kind === 'discord') return `discord:${actor.member?.id ?? '?'}`;
  if (actor.kind === 'in_game') return `ingame:${actor.playerName}`;
  if (actor.kind === 'api') return `api:${actor.tokenId ?? '?'}`;
  return 'unknown';
}

function stripTrailingNoise(text) {
  return text.replace(/\s+/g, ' ').trim();
}

export async function runAssistantPipeline(tenantCtx, {
  question,
  channelContext = null,
  imageUrls = [],
  actor,
  isInGame = false,
}) {
  const sys = buildSystemPrompt(tenantCtx, { actorKey: actorKey(actor) });

  let ragContext = '';
  try {
    const chunks = await retrieveSources(tenantCtx, question, 6);
    if (chunks.length) {
      ragContext = '\n\nRELEVANT KNOWLEDGE (retrieved from configured sources):\n' +
        chunks.map((c, i) => `[${i + 1}] (${c.label || c.sourceRef}): ${c.text}`).join('\n\n');
    }
  } catch (err) {
    console.warn('[pipeline] retrieve failed:', err.message);
  }

  let webContext = '';
  const needsWeb = !ragContext.includes(question.slice(0, 40)) && (WEB_TRIGGER.test(question) || question.length > 60);
  if (needsWeb) {
    try {
      const results = await webSearch(question, { count: 4 });
      if (results.length) {
        webContext = '\n\nWEB SEARCH RESULTS:\n' +
          results.map((r, i) => `[${i + 1}] ${r.title} — ${r.snippet} (${r.url})`).join('\n');
      }
    } catch (err) {
      console.warn('[pipeline] web search failed:', err.message);
    }
  }

  const userContent = [
    { type: 'text', text: stripTrailingNoise(question) },
    ...(channelContext ? [{ type: 'text', text: `\n\nRECENT CHANNEL MESSAGES:\n${channelContext}` }] : []),
    ...(ragContext ? [{ type: 'text', text: ragContext }] : []),
    ...(webContext ? [{ type: 'text', text: webContext }] : []),
    ...(imageUrls?.length ? imageUrls.map((u) => ({ type: 'image_url', image_url: u })) : []),
  ];

  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: userContent },
  ];

  const { getToolsForMistral } = await import('./tools.js');
  const tools = getToolsForMistral();

  let finalText = '';
  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    let resp;
    try {
      resp = await client().chat({
        model: 'mistral-large-2512',
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
      });
    } catch (err) {
      return { text: `LLM call failed: ${err.message}`, tools: [], error: err.message };
    }

    const choice = resp.choices?.[0];
    if (!choice) return { text: 'No response from model.', tools: [] };

    const msg = choice.message;
    const toolCalls = msg.tool_calls || [];

    if (toolCalls.length === 0) {
      finalText = typeof msg.content === 'string' ? msg.content : (msg.content?.[0]?.text || '');
      break;
    }

    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: toolCalls });

    const toolResults = [];
    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args = {};
      try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { /* malformed args */ }

      const result = await executeTool(tenantCtx, name, args, actor);

      toolResults.push({
        tool_call_id: tc.id,
        role: 'tool',
        name,
        content: JSON.stringify(result),
      });
    }

    messages.push(...toolResults);
  }

  return { text: finalText || 'I could not produce a response.', tools: [] };
}
