import OpenAI from 'openai';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { retrieveSources } from '../rag/retrieve.js';
import { webSearch } from '../integrations/brave.js';
import { executeTool } from './executor.js';
import { buildSystemPrompt } from './prompts.js';
import { loadConfig } from '../config.js';
import { addMemory } from '../tenant/store.js';
import { actorKey } from './utils.js';

let _client = null;
function client() {
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

const MAX_TOOL_STEPS = 6;
const WEB_TRIGGER = /(?:^|\s)(?:what|who|where|when|why|how|latest|current|today|news|release|update|is|are|do|does)\b/i;

function normaliseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

export async function runAssistantPipeline(tenantCtx, {
  question,
  channelContext = null,
  imageUrls = [],
  actor,
  isInGame = false,
  history = [],
}) {
  const sys = buildSystemPrompt(tenantCtx, { actorKey: actorKey(actor), actor });

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
          results.map((r, i) => `[${i + 1}] ${r.title} \u2014 ${r.snippet} (${r.url})`).join('\n');
      }
    } catch (err) {
      console.warn('[pipeline] web search failed:', err.message);
    }
  }

  const userContent = [
    { type: 'text', text: normaliseWhitespace(question) },
    ...(channelContext ? [{ type: 'text', text: `\n\nRECENT CHANNEL MESSAGES:\n${channelContext}` }] : []),
    ...(ragContext ? [{ type: 'text', text: ragContext }] : []),
    ...(webContext ? [{ type: 'text', text: webContext }] : []),
    ...(imageUrls?.length ? imageUrls.map((u) => ({ type: 'image_url', image_url: { url: u } })) : []),
  ];

  const messages = [
    { role: 'system', content: sys },
    ...history,
    { role: 'user', content: userContent },
  ];

  const { getToolsForMistral } = await import('./tools.js');
  const tools = getToolsForMistral();

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
      return { text: `LLM call failed: ${err.message}`, tools: [], error: err.message };
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
    finalText = 'I completed the requested actions, but could not generate a final reply. Please try again.';
  }

  return { text: finalText, tools: [] };
}
