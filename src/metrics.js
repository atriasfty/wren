import client from 'prom-client';
import { getClient } from './discord/client.js';

/**
 * Prometheus metrics for wren — a single long-running process (no HMR/module
 * duplication concern like POW's Next.js dashboard has), so no globalThis
 * singleton guard needed here.
 */

export const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'wren_' });

export const httpRequestDuration = new client.Histogram({
  name: 'wren_http_request_duration_seconds',
  help: 'HTTP request duration for the Express API server',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const chatPipelineDuration = new client.Histogram({
  name: 'wren_chat_pipeline_duration_seconds',
  help: 'Full runAssistantPipeline duration — RAG retrieval + tool calls + LLM, not just the raw LLM call',
  buckets: [0.25, 0.5, 1, 2, 5, 10, 20, 30, 60],
  registers: [register],
});

export const chatPipelineErrors = new client.Counter({
  name: 'wren_chat_pipeline_errors_total',
  help: 'Chat pipeline failures',
  registers: [register],
});

export const llmTokens = new client.Counter({
  name: 'wren_llm_tokens_total',
  help: 'LLM token usage from OpenRouter chat completion responses (resp.usage)',
  labelNames: ['type', 'model'], // type: prompt | completion
  registers: [register],
});

export const mcpToolCalls = new client.Counter({
  name: 'wren_mcp_tool_calls_total',
  help: 'Tool calls executed via executor.js, by tool name and outcome',
  labelNames: ['tool', 'outcome'], // outcome: ok | error
  registers: [register],
});

export const mcpToolDuration = new client.Histogram({
  name: 'wren_mcp_tool_duration_seconds',
  help: 'Tool execution duration by tool name',
  labelNames: ['tool'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20],
  registers: [register],
});

export const dbQueryDuration = new client.Histogram({
  name: 'wren_db_query_duration_seconds',
  help: 'Postgres query duration via db/pool.js query()',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [register],
});

export const ragRetrievalDuration = new client.Histogram({
  name: 'wren_rag_retrieval_duration_seconds',
  help: 'retrieveSources() duration — the RAG lookup inside runAssistantPipeline',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

export const ragRetrievalEmpty = new client.Counter({
  name: 'wren_rag_retrieval_empty_total',
  help: 'retrieveSources() calls that returned zero results',
  registers: [register],
});

export const ragRetrievalErrors = new client.Counter({
  name: 'wren_rag_retrieval_errors_total',
  help: 'retrieveSources() calls that threw (pipeline.js already swallows these — see the catch there)',
  registers: [register],
});

export const quotaBlockedTotal = new client.Counter({
  name: 'wren_quota_blocked_total',
  help: 'Chat requests blocked because a tenant hit its tier message-quota — an upgrade-funnel signal',
  labelNames: ['tier'],
  registers: [register],
});

export const voiceWakewordDetections = new client.Counter({
  name: 'wren_voice_wakeword_detections_total',
  help: 'Wake-word ("hey wren") detections that passed the quota check and started a listening session',
  registers: [register],
});

export const voiceQuotaBlocked = new client.Counter({
  name: 'wren_voice_quota_blocked_total',
  help: 'Wake-word detections rejected because the tenant is out of voice minutes for its tier',
  labelNames: ['tier'],
  registers: [register],
});

export const voiceSttDuration = new client.Histogram({
  name: 'wren_voice_stt_duration_seconds',
  help: 'Speech-to-text (OpenRouter/Parakeet) call duration',
  buckets: [0.5, 1, 2, 5, 10, 20, 30],
  registers: [register],
});

export const voiceSttErrors = new client.Counter({
  name: 'wren_voice_stt_errors_total',
  help: 'Speech-to-text call failures',
  registers: [register],
});

export const voiceTtsDuration = new client.Histogram({
  name: 'wren_voice_tts_duration_seconds',
  help: 'Text-to-speech (OpenRouter/Kokoro) call duration',
  buckets: [0.5, 1, 2, 5, 10, 20, 30],
  registers: [register],
});

export const voiceTtsErrors = new client.Counter({
  name: 'wren_voice_tts_errors_total',
  help: 'Text-to-speech call failures',
  registers: [register],
});

export const voiceActiveSessions = new client.Gauge({
  name: 'wren_voice_active_sessions',
  help: 'Guilds currently in an active voice session (activeGuilds map size)',
  registers: [register],
  async collect() {
    const { getActiveVoiceSessionCount } = await import('./discord/voice/manager.js');
    this.set(getActiveVoiceSessionCount());
  },
});

export const mcpConnectionsActive = new client.Gauge({
  name: 'wren_mcp_connections_active',
  help: 'Active SSE transport connections on the external MCP server endpoint (api/mcp.js)',
  registers: [register],
  async collect() {
    const { getActiveMcpConnectionCount } = await import('./api/mcp.js');
    this.set(getActiveMcpConnectionCount());
  },
});

export const mcpAuthFailures = new client.Counter({
  name: 'wren_mcp_auth_failures_total',
  help: 'Auth failures on the external MCP server endpoint',
  registers: [register],
});

export const externalApiDuration = new client.Histogram({
  name: 'wren_external_api_duration_seconds',
  help: 'Outbound calls to external integrations (PRC, POW public API, Brave Search, Roblox)',
  labelNames: ['service', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const ingestDuration = new client.Histogram({
  name: 'wren_ingest_duration_seconds',
  help: 'Knowledge-base ingestion run duration (/wren ingest)',
  labelNames: ['outcome'],
  buckets: [1, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

export const ingestChunks = new client.Counter({
  name: 'wren_ingest_chunks_total',
  help: 'Document chunks processed by ingestion runs',
  registers: [register],
});

export const memoryOps = new client.Counter({
  name: 'wren_memory_ops_total',
  help: 'Memory feature usage (add/remove) via tenant/store.js',
  labelNames: ['op'],
  registers: [register],
});

export const guildEvents = new client.Counter({
  name: 'wren_guild_events_total',
  help: 'Guild join/leave events — a point-in-time gauge (wren_discord_guild_count) cannot show churn',
  labelNames: ['event'],
  registers: [register],
});

// 0 = READY, matching discord.js's WebSocket status enum — same convention
// POW's bot already uses, so the two are directly comparable in Grafana.
export const discordGatewayStatus = new client.Gauge({
  name: 'wren_discord_gateway_status',
  help: "Discord gateway WebSocket status (client.ws.status — 0 = READY)",
  registers: [register],
  collect() {
    const c = getClient();
    this.set(c ? c.ws.status : -1);
  },
});

export const discordGuildCount = new client.Gauge({
  name: 'wren_discord_guild_count',
  help: 'Number of guilds (tenants) the bot is currently in',
  registers: [register],
  collect() {
    const c = getClient();
    this.set(c ? c.guilds.cache.size : 0);
  },
});
