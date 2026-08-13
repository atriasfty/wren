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
