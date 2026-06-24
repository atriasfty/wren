# Wren

Multi-tenant Discord bot for ERLC (Emergency Response: Liberty County) servers. Each Discord guild gets its own tenant — its own knowledge base, its own ERLC server key, its own permission policy, its own memory. Configure everything with `/wren` slash commands; nothing is hard-coded.

## Architecture at a glance

- **Multi-tenant**: one Postgres DB on Railway, one row in `tenants` per Discord guild, every other table keyed by `tenant_id` with composite indexes. No shared mutable state in module scope.
- **Discord**: `discord.js` v14. Mention the bot (or reply to it) to chat. Slash commands live under `/wren` for server admins.
- **AI**: OpenRouter (`mistralai/mistral-large-2411`) with function-calling. 26 tools covering mod actions, Discord introspection, ERLC server queries, and memory.
- **RAG**: per-tenant JSON vector store at `data/tenants/<guild_id>/vector-store.json`. Sources can be Discord channels, websites, or manual documents — each weighted.
- **Web search**: Brave Search API (with page-fetch fallback).
- **POW**: per-tenant token, AES-256-GCM encrypted at rest, key in env.
- **PRC**: per-tenant ERLC server key, encrypted at rest.
- **Permission gate**: deny by default — every tool requires a `tenant_role_policy` row; rank resolved from `tenant_roles` + Discord guild permissions.
- **REST API**: `POST /v1/chat`, `GET /v1/info` on `:42011` (configurable). Bearer-token auth backed by `tenant_api_tokens`.

## Quick start

```bash
npm install
cp .env.example .env       # fill in the values below
npm run migrate            # creates the schema in Postgres
npm start
```

On boot Wren registers `/wren` in every guild it is a member of and (re)starts the raid poller and in-game bridge.

### Environment

| Key | Required | Notes |
|---|---|---|
| `DISCORD_TOKEN` | yes | Bot token. Enable Message Content Intent in the dev portal. |
| `OPENROUTER_API_KEY` | yes | https://openrouter.ai/ |
| `OPENROUTER_MODEL` | yes | OpenRouter model string (e.g. `mistralai/mistral-large-2411`). |
| `BRAVE_SEARCH_API_KEY` | yes | https://brave.com/search/api/ |
| `DATABASE_URL` | yes | Postgres connection string. |
| `TENANT_SECRET_ENC_KEY` | yes | base64 of 32 random bytes. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `API_PORT` | no | REST API listen port (default 42011). |

**Rotate `DATABASE_URL` after first run.** The string is in this README's git history; the password should not be considered secret.

## Onboarding a new server

1. Invite the bot to the guild.
2. Run `/wren setup`. Creates the `tenants` row.
3. `/wren config erlc …` and `/wren config pow …` — store the keys (encrypted at rest).
4. `/wren config status-channel`, `/wren config erlc-log-channel`, `/wren config ticket-category`, etc., to wire the bot into your server.
5. `/wren roles set` to map perk/staff roles (whitelist, booster, la_plus, la_premium, staff_a/b/c).
6. `/wren sources add channel|website|document …` to point Wren at sources of truth.
7. `/wren ingest run` — builds the per-tenant vector store.
8. Mention the bot in a channel; it answers using RAG + tools.

## Slash commands (under `/wren`)

All require `ManageGuild` unless noted; some require server owner.

- `setup` — create the tenant row (idempotent).
- `config view`, `config set key:<k> value:<v>` (freeform for the whitelisted keys), plus typed subcommands:
  - `core-info`, `response-style`, `bot-name`, `in-game-handle`, `raid-auto-punish`,
  - `status-channel`, `erlc-log-channel`, `ticket-category`, `security-role`, `raid-alert`.
- `sources list`, `add`, `remove`, `toggle` — Discord channels, websites, manual docs. Each has a weight (0–2).
- `policy view`, `set tool:<name> min-role:<owner|admin|mod|staff|user>` — defaults are seeded on `setup`.
- `roles view`, `set slot:<whitelist|booster|la_plus|la_premium|staff_a|b|c|staff> role:<role>`.
- `bans list`, `add`, `remove` — the per-tenant bot ban list (replaces the old in-memory Set).
- `memory list`, `add`, `remove` — server/user scoped facts.
- `ingest run` (owner only), `ingest status` — rebuilds the vector store.

## How Wren answers

1. Bot is mentioned or replied to in a channel.
2. Tenant context resolved by `guild.id`. If unknown, the bot says so and bails (no data leak between tenants).
3. System prompt built from `botDisplayName`, `coreInfo`, `responseStyle`, configured sources, and tenant-scoped memory.
4. RAG: top-K cosine over `data/tenants/<id>/vector-store.json`, weighted per source.
5. If no chunk is clearly relevant, Brave Search is consulted (rate-limited).
6. OpenRouter returns either a final answer or a list of `tool_calls`. The pipeline loops up to 6 steps:
   - Each tool call goes through `canRunTool(...)` — deny by default.
   - Mass-action targets (`all`, `everyone`, `*`, …) are rejected before any API call.
   - Every mod-tool invocation writes an `audit_log` row.
7. Final answer is sent in Discord messages (split if it exceeds 1900 chars).

## Development

```bash
npm test           # vitest — crypto, policy, brave wrapper, retrieve, slash validation
npm run dev        # node --watch
npm run ingest -- --tenant=<guildId>   # backfill ingestion for one tenant
```

## Project layout

```
src/
├── index.js              # bootstrapper: migrations, login, attach handlers
├── config.js             # env loader (fails loud if anything missing)
├── db/                   # pg pool + schema.sql + migrate
├── tenant/               # CRUD store, crypto, ctx builder, resolver (60s cache)
├── integrations/         # prc.js, pow.js, bloxlink.js, brave.js, search/webpage.js
├── rag/                  # per-tenant JSON vector store + MiniLM embedder
├── ai/                   # tool catalog, policy gate, prompt builder, LLM pipeline
├── discord/              # client + message/ticket/raid/ingame handlers
├── slash/                # /wren command tree and dispatch
├── api/                  # express REST server, bearer-token auth
└── __tests__/            # vitest suites (pure logic only)
```

## Security notes

- All per-tenant secrets are AES-256-GCM encrypted; key in env, IV per-write.
- Permission gate denies by default — an empty policy table means nothing works.
- Mass-action targets are filtered at the executor boundary.
- API tokens are stored as sha256 hashes; the plaintext is shown once at issue.
- Self-targeting (`wren`, `bot`) is blocked for any mod tool.

## License

ISC.
