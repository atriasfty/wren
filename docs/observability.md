# Observability

Wren exposes Prometheus metrics at `GET /metrics` (gated behind
`WREN_METRICS_SECRET` as a Bearer token — see `.env.example`). Instrumented:

- `wren_http_request_duration_seconds{method,route,status}` — every request
  through the Express API server (`src/api/server.js`).
- `wren_chat_pipeline_duration_seconds` / `wren_chat_pipeline_errors_total` —
  the full `/v1/chat` pipeline (RAG retrieval + tool calls + LLM), not just
  the raw LLM call (that's separately traced via OpenTelemetry spans to
  PostHog when `POSTHOG_API_KEY` is set — see `src/observability.js`).
- `wren_db_query_duration_seconds` — every query through `src/db/pool.js`'s
  `query()`.
- `wren_discord_gateway_status` / `wren_discord_guild_count` — read live from
  the Discord client, no event wiring needed (`src/metrics.js`).
- Node.js runtime metrics (`wren_nodejs_*`, `wren_process_*`) via
  `prom-client`'s `collectDefaultMetrics()`.

## Where this actually gets scraped and graphed

There's no separate Prometheus/Grafana for Wren — it shares the stack Atria
already runs for POW, on the same box. **The scrape config and dashboards
are source-of-truth in the POW repo** (`atriasfty/p-ow`), under
`observability/`:

- Scrape job: `observability/prometheus/prometheus.yml` (`wren-prod`)
- Dashboard: `observability/grafana/wren-dashboards/wren-overview.json`
  (shows up in Grafana under the **Wren** folder, separate from POW's)

If you add a new Wren metric worth graphing, add the panel there, not in
this repo — this file is just a map so you know where to look.
