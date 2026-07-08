import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BasicTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { trace } from '@opentelemetry/api';

const mockOpenAIChat = vi.fn();

vi.mock('openai', () => {
  return {
    default: class {
      constructor() {
        this.chat = {
          completions: {
            create: mockOpenAIChat
          }
        };
      }
    }
  };
});

vi.mock('../config.js', () => ({
  loadConfig: () => ({
    discordToken: 'token',
    openRouterApiKey: 'key',
    openRouterModel: 'mistralai/mistral-large-2411',
    databaseUrl: 'url',
    tenantSecretEncKey: Buffer.alloc(32),
  })
}));

vi.mock('../tenant/store.js', () => ({
  incrementMessageUsage: vi.fn().mockResolvedValue(1),
  addMemory: vi.fn(),
}));

describe('observability tracing in assistant pipeline', () => {
  let memoryExporter;
  let provider;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a memory exporter for OTel spans
    memoryExporter = new InMemorySpanExporter();
    
    // Set up tracing provider using OTel API
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(memoryExporter)]
    });
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(async () => {
    // Disable tracer provider to prevent leak between tests
    await provider.shutdown();
    trace.disable();
  });

  it('records correct manual gen_ai spans during pipeline execution', async () => {
    mockOpenAIChat.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Here is the response.' } }],
      usage: { prompt_tokens: 10, completion_tokens: 15 }
    });

    const { runAssistantPipeline } = await import('../ai/pipeline.js');

    const tenantCtx = {
      tenantId: 'guild-abc',
      tenant: {
        botDisplayName: 'Wren',
        displayName: 'Test Server',
        inGameHandle: ':pm wren',
        erlcServerKey: 'key',
      },
      sources: [],
      memory: []
    };

    const actor = { kind: 'discord', member: { id: 'user-123' } };

    const result = await runAssistantPipeline(tenantCtx, {
      question: 'hello bot',
      actor,
    });

    expect(result.text).toBe('Here is the response.');

    // Fetch the recorded spans
    const spans = memoryExporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);

    const genAiSpan = spans.find((s) => s.name === 'gen_ai.chat');
    expect(genAiSpan).toBeDefined();

    const attrs = genAiSpan.attributes;
    expect(attrs['gen_ai.system']).toBe('openrouter');
    expect(attrs['gen_ai.request.model']).toBe('mistralai/mistral-large-2411');
    expect(attrs['posthog.distinct_id']).toBe('discord:user-123');
    expect(attrs['posthog.tenant_id']).toBe('guild-abc');
    expect(attrs['gen_ai.usage.input_tokens']).toBe(10);
    expect(attrs['gen_ai.usage.output_tokens']).toBe(15);
    expect(attrs['gen_ai.input.messages']).toBeDefined();
    expect(attrs['gen_ai.output.messages']).toBeDefined();
  });

  it('handles LLM API call failure and records error status and exception on the span', async () => {
    const errorMsg = 'API key expired';
    mockOpenAIChat.mockRejectedValue(new Error(errorMsg));

    const { runAssistantPipeline } = await import('../ai/pipeline.js');

    const tenantCtx = {
      tenantId: 'guild-abc',
      tenant: {
        botDisplayName: 'Wren',
        displayName: 'Test Server',
        inGameHandle: ':pm wren',
        erlcServerKey: 'key',
      },
      sources: [],
      memory: []
    };

    const actor = { kind: 'discord', member: { id: 'user-123' } };

    const result = await runAssistantPipeline(tenantCtx, {
      question: 'hello bot',
      actor,
    });

    // The public reply must stay generic — internal error detail lives only
    // in result.error (and the span/log), never in channel-visible text.
    expect(result.text).toContain('something went wrong');
    expect(result.text).not.toContain(errorMsg);
    expect(result.error).toBe(errorMsg);

    const spans = memoryExporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    const genAiSpan = spans.find((s) => s.name === 'gen_ai.chat');
    expect(genAiSpan).toBeDefined();

    expect(genAiSpan.status.code).toBe(2); // SpanStatusCode.ERROR is 2
    expect(genAiSpan.status.message).toBe(errorMsg);
    
    // Check if exception event was recorded
    expect(genAiSpan.events.length).toBeGreaterThan(0);
    const exceptionEvent = genAiSpan.events.find(e => e.name === 'exception');
    expect(exceptionEvent).toBeDefined();
  });

  it('handles empty choices response gracefully', async () => {
    mockOpenAIChat.mockResolvedValue({
      choices: [],
      usage: { prompt_tokens: 5, completion_tokens: 0 }
    });

    const { runAssistantPipeline } = await import('../ai/pipeline.js');

    const tenantCtx = {
      tenantId: 'guild-abc',
      tenant: {},
      sources: [],
      memory: []
    };

    const actor = { kind: 'discord', member: { id: 'user-123' } };

    const result = await runAssistantPipeline(tenantCtx, {
      question: 'hello bot',
      actor,
    });

    expect(result.text).toBe('No response from model.');

    const spans = memoryExporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    const genAiSpan = spans.find((s) => s.name === 'gen_ai.chat');
    expect(genAiSpan).toBeDefined();
    
    // Verify usage attributes are still recorded
    const attrs = genAiSpan.attributes;
    expect(attrs['gen_ai.usage.input_tokens']).toBe(5);
    expect(attrs['gen_ai.usage.output_tokens']).toBe(0);
    // gen_ai.output.messages should not be set because there was no message
    expect(attrs['gen_ai.output.messages']).toBeUndefined();
  });

  it('handles missing tenantId and missing actor gracefully', async () => {
    mockOpenAIChat.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Hello!' } }],
      usage: { prompt_tokens: 3, completion_tokens: 4 }
    });

    const { runAssistantPipeline } = await import('../ai/pipeline.js');

    // Missing tenantId, missing actor
    const tenantCtx = {
      tenant: {},
      sources: [],
      memory: []
    };

    const result = await runAssistantPipeline(tenantCtx, {
      question: 'hello bot',
    });

    expect(result.text).toBe('Hello!');

    const spans = memoryExporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    const genAiSpan = spans.find((s) => s.name === 'gen_ai.chat');
    expect(genAiSpan).toBeDefined();
    
    const attrs = genAiSpan.attributes;
    expect(attrs['posthog.tenant_id']).toBeUndefined();
    expect(attrs['posthog.distinct_id']).toBe('unknown');
  });

  it('handles usage token count missing fields gracefully', async () => {
    mockOpenAIChat.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Response' } }],
      usage: {} // empty usage object
    });

    const { runAssistantPipeline } = await import('../ai/pipeline.js');

    const tenantCtx = {
      tenantId: 'guild-xyz',
      tenant: {},
      sources: [],
      memory: []
    };

    const result = await runAssistantPipeline(tenantCtx, {
      question: 'hello',
    });

    expect(result.text).toBe('Response');

    const spans = memoryExporter.getFinishedSpans();
    const genAiSpan = spans.find((s) => s.name === 'gen_ai.chat');
    expect(genAiSpan).toBeDefined();
    
    const attrs = genAiSpan.attributes;
    expect(attrs['gen_ai.usage.input_tokens']).toBe(0);
    expect(attrs['gen_ai.usage.output_tokens']).toBe(0);
  });
});
