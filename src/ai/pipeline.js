import OpenAI from 'openai';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { retrieveSources } from '../rag/retrieve.js';
import { executeTool } from './executor.js';
import { buildSystemPrompt } from './prompts.js';
import { loadConfig } from '../config.js';
import { incrementMessageUsage, decrementMessageUsage } from '../tenant/store.js';
import { actorKey } from './utils.js';

let _client = null;
export function client() {
  if (!_client) {
    const cfg = loadConfig();
    _client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: cfg.openRouterApiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://atriasafety.org',
        'X-Title': 'Wren',
      },
    });
  }
  return _client;
}

const MAX_TOOL_STEPS = 8;

function normaliseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

export async function runAssistantPipeline(tenantCtx, {
  question,
  channelContext = null,
  imageUrls = [],
  documentsText = '',
  actor,
  channelId = null,
  isInGame = false,
  history = [],
  mode = 'discord',
}) {
  const tier = tenantCtx.tenant.subscriptionTier || 'free';
  const limits = { free: 10, core: 1000, pro: 5000 };
  const limit = limits[tier] || 10;
  
  const used = await incrementMessageUsage(tenantCtx.tenantId, limit);
  if (used > limit) {
    return { text: `⚠️ This server has used all **${limit}** messages included in its **${tier.toUpperCase()}** plan this month. A server manager can run \`/wren upgrade\` to raise the limit, or \`/wren usage\` to see when it resets.`, error: null };
  }

  const sys = buildSystemPrompt(tenantCtx, { actorKey: actorKey(actor), actor, channelId, mode });

  let ragContext = '';
  try {
    const results = await retrieveSources(tenantCtx, question, 6);
    if (results.length) {
      ragContext = '\n\nRELEVANT KNOWLEDGE (retrieved from configured sources):\n' +
        results.map((r, i) => `[${i + 1}] (${r.chunk.label || r.chunk.sourceRef}): ${r.chunk.text}`).join('\n\n');
    }
  } catch (err) {
    console.warn('[pipeline] retrieve failed:', err.message);
  }

  const userContent = [
    { type: 'text', text: normaliseWhitespace(question) },
    ...(channelContext ? [{ type: 'text', text: `\n\nRECENT CHANNEL MESSAGES:\n${channelContext}` }] : []),
    ...(ragContext ? [{ type: 'text', text: ragContext }] : []),
    ...(documentsText ? [{ type: 'text', text: `\n\nATTACHED DOCUMENTS:\n${documentsText}` }] : []),
    // TEMPORARY: the current model has no vision support, so image parts are
    // disabled — the model is told about the attachment instead of receiving
    // it. Restore the commented line below when switching back to a vision-
    // capable model.
    // ...(imageUrls?.length ? imageUrls.map((u) => ({ type: 'image_url', image_url: { url: u } })) : []),
    ...(imageUrls?.length ? [{ type: 'text', text: `\n\n[NOTE: The user attached ${imageUrls.length} image${imageUrls.length === 1 ? '' : 's'}, but the current model does not support image input. Let the user know you cannot view images right now.]` }] : []),
  ];

  const messages = [
    { role: 'system', content: sys },
    ...history,
    { role: 'user', content: userContent },
  ];

  const { getToolsForMistral } = await import('./tools.js');
  const tools = getToolsForMistral({ isDiscordActor: actor?.kind === 'discord' });

  let finalText = '';
  const tracer = trace.getTracer('wren');
  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    let resp;
    const span = tracer.startSpan('gen_ai.chat', {
      attributes: {
        'gen_ai.system': 'openrouter',
        'gen_ai.request.model': loadConfig().openRouterModel,
        'gen_ai.input.messages': JSON.stringify(messages),
        'posthog.distinct_id': actorKey(actor),
        'posthog.tenant_id': tenantCtx.tenantId,
      }
    });
    try {
      resp = await client().chat.completions.create({
        model: loadConfig().openRouterModel,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
      });
      if (resp.usage) {
        span.setAttributes({
          'gen_ai.usage.input_tokens': resp.usage.prompt_tokens ?? 0,
          'gen_ai.usage.output_tokens': resp.usage.completion_tokens ?? 0,
        });
      }
      if (resp.choices?.[0]?.message) {
        span.setAttribute('gen_ai.output.messages', JSON.stringify([resp.choices[0].message]));
      }
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.end();
      console.error('[pipeline] LLM call failed:', err);
      // A failed run must not consume the tenant's quota — refund the
      // increment from the top of this function (best-effort).
      await decrementMessageUsage(tenantCtx.tenantId).catch((e) => console.warn('[pipeline] usage refund failed:', e.message));
      // The reply is posted publicly — never surface provider/internal detail.
      return { text: 'Sorry, something went wrong while generating a response. Please try again in a moment.', tools: [], error: err.message };
    }
    span.end();

    const choice = resp.choices?.[0];
    if (!choice) return { text: 'No response from model.', tools: [] };

    const msg = choice.message;
    const toolCalls = msg.tool_calls || [];

    if (toolCalls.length === 0) {
      finalText = typeof msg.content === 'string' ? msg.content : (msg.content?.[0]?.text || '');
      break;
    }

    // Set content to null (not empty string) when tool_calls are present
    const assistantContent = msg.content == null || msg.content === '' ? null : msg.content;
    messages.push({ role: 'assistant', content: assistantContent, tool_calls: toolCalls });

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

  if (!finalText) {
    // Ran out of tool steps mid-research. Force one more call with no tool
    // access so the model summarizes whatever it already gathered instead of
    // leaving the user with a dead-end reply.
    try {
      const resp = await client().chat.completions.create({
        model: loadConfig().openRouterModel,
        messages,
        tools,
        tool_choice: 'none',
        temperature: 0.2,
      });
      const msg = resp.choices?.[0]?.message;
      finalText = typeof msg?.content === 'string' ? msg.content : (msg?.content?.[0]?.text || '');
    } catch (err) {
      console.error('[pipeline] forced final reply failed:', err);
    }
  }

  if (!finalText) {
    finalText = 'I completed the requested actions, but could not generate a final reply. Please try again.';
  }

  return { text: finalText, tools: [] };
}
