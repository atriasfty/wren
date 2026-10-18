import OpenAI from 'openai';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { retrieveSources } from '../rag/retrieve.js';
import { executeTool } from './executor.js';
import { runModelLoop } from './loop.js';
import { buildSystemPrompt } from './prompts.js';
import { loadConfig } from '../config.js';
import { incrementMessageUsageForTier, decrementMessageUsage } from '../tenant/store.js';
import { captionImages } from './images.js';
import { actorKey } from './utils.js';
import { llmTokens, ragRetrievalErrors, quotaBlockedTotal } from '../metrics.js';

// Opt-in: export full prompt/response bodies on gen_ai spans.
const traceContent = () => process.env.WREN_TRACE_CONTENT === '1';

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

function normaliseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

export function formatRagContext(results) {
  if (!results.length) return '';
  return '\n\nRELEVANT KNOWLEDGE (retrieved from configured sources):\n' +
    results.map((r, i) => `[${i + 1}] (${r.chunk.label || r.chunk.sourceRef}): ${r.chunk.text}`).join('\n\n');
}

export function buildUserContent({ question, channelContext = null, ragContext = '', documentsText = '', imageRefs = [], imageUrls = [] }) {
  return [
    { type: 'text', text: normaliseWhitespace(question) },
    ...(channelContext ? [{ type: 'text', text: `\n\nRECENT CHANNEL MESSAGES:\n${channelContext}` }] : []),
    ...(ragContext ? [{ type: 'text', text: ragContext }] : []),
    ...(documentsText ? [{ type: 'text', text: `\n\nATTACHED DOCUMENTS:\n${documentsText}` }] : []),
    ...(imageRefs?.length ? [{ type: 'text', text: `\n\n[Attached to THIS message: ${imageRefs.map((r) => `image id=${r.id}`).join(', ')}]` }] : []),
    ...(imageUrls?.length ? imageUrls.map((u) => ({ type: 'image_url', image_url: { url: u } })) : []),
  ];
}

export async function runAssistantPipeline(tenantCtx, {
  question,
  channelContext = null,
  imageUrls = [],
  imageRefs = [], // [{ id, url }] — same images with stable ids, for captioning/recall
  documentsText = '',
  actor,
  channelId = null,
  isInGame = false,
  history = [],
  mode = 'discord',
  onToolStep = null,
}) {
  const limits = { free: 10, core: 1000, pro: 5000 };
  // Tier comes back from the same statement that may have reset the cycle —
  // the cached tenantCtx tier can be stale by up to a minute and across resets.
  const { used, tier: usageTier } = await incrementMessageUsageForTier(tenantCtx.tenantId, limits);
  const tier = usageTier || 'free';
  const limit = limits[tier] || 10;
  if (used > limit) {
    quotaBlockedTotal.inc({ tier });
    return { text: `⚠️ This server has used all **${limit}** messages included in its **${tier.toUpperCase()}** plan this month. A server manager can run \`/wren upgrade\` to raise the limit, or \`/wren usage\` to see when it resets.`, error: null };
  }

  const sys = buildSystemPrompt(tenantCtx, { actorKey: actorKey(actor), actor, channelId, mode });

  let ragContext = '';
  try {
    const results = await retrieveSources(tenantCtx, question, 6);
    ragContext = formatRagContext(results);
  } catch (err) {
    ragRetrievalErrors.inc();
    console.warn('[pipeline] retrieve failed:', err.message);
  }

  // Caption new images in the background so later turns can recall them from
  // text. Deliberately not awaited: it must not delay the reply.
  if (imageRefs?.length) {
    captionImages({ client: client(), model: loadConfig().openRouterModel }, imageRefs)
      .catch((e) => console.warn('[pipeline] captioning failed:', e.message));
  }

  const userContent = buildUserContent({ question, channelContext, ragContext, documentsText, imageRefs, imageUrls });

  const messages = [
    { role: 'system', content: sys },
    ...history,
    { role: 'user', content: userContent },
  ];

  const { getToolsForMistral } = await import('./tools.js');
  const tools = getToolsForMistral({ isDiscordActor: actor?.kind === 'discord', canAttachFiles: mode !== 'voice' });

  const tracer = trace.getTracer('wren');
  const model = loadConfig().openRouterModel;
  const complete = async (params) => {
    const span = tracer.startSpan('gen_ai.chat', {
      attributes: {
        'gen_ai.system': 'openrouter',
        'gen_ai.request.model': model,
        // Full prompts carry memory, channel history and attached documents;
        // only export them when explicitly opted in.
        ...(traceContent() ? { 'gen_ai.input.messages': JSON.stringify(params.messages) } : {}),
        'posthog.distinct_id': actorKey(actor),
        'posthog.tenant_id': tenantCtx.tenantId,
      }
    });
    try {
      const resp = await client().chat.completions.create(params);
      if (resp.usage) {
        span.setAttributes({
          'gen_ai.usage.input_tokens': resp.usage.prompt_tokens ?? 0,
          'gen_ai.usage.output_tokens': resp.usage.completion_tokens ?? 0,
        });
        if (resp.usage.prompt_tokens) llmTokens.inc({ type: 'prompt', model }, resp.usage.prompt_tokens);
        if (resp.usage.completion_tokens) llmTokens.inc({ type: 'completion', model }, resp.usage.completion_tokens);
      }
      if (traceContent() && resp.choices?.[0]?.message) {
        span.setAttribute('gen_ai.output.messages', JSON.stringify([resp.choices[0].message]));
      }
      return resp;
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  };

  let finalText;
  let noChoice;
  const generatedImages = [];
  try {
    ({ text: finalText, noChoice } = await runModelLoop({
      complete,
      runTool: (name, args) => executeTool(tenantCtx, name, args, actor),
      model,
      messages,
      tools,
      onToolStep,
      generatedImages,
    }));
  } catch (err) {
    console.error('[pipeline] LLM call failed:', err);
    // An image was already generated (and its weekly allowance spent) before the
    // model failed to write the reply: deliver it rather than throw it away,
    // and keep the message charge since the user did get something.
    if (generatedImages.length) {
      return { text: "Sorry, I hit a snag writing my reply, but here's the image you asked for.", tools: [], images: generatedImages, error: err.message };
    }
    // A failed run must not consume the tenant's quota — refund the
    // increment from the top of this function (best-effort).
    await decrementMessageUsage(tenantCtx.tenantId).catch((e) => console.warn('[pipeline] usage refund failed:', e.message));
    // The reply is posted publicly — never surface provider/internal detail.
    return { text: 'Sorry, something went wrong while generating a response. Please try again in a moment.', tools: [], error: err.message };
  }

  if (noChoice) {
    // The provider returned no choices at all — that's a failed run, not an
    // answer: refund it and don't post the internal placeholder publicly.
    await decrementMessageUsage(tenantCtx.tenantId).catch((e) => console.warn('[pipeline] usage refund failed:', e.message));
    return { text: 'Sorry, something went wrong while generating a response. Please try again in a moment.', tools: [], error: 'no choices returned' };
  }

  if (!finalText) {
    finalText = 'I completed the requested actions, but could not generate a final reply. Please try again.';
  }

  return { text: finalText, tools: [], images: generatedImages };
}
