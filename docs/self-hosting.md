# Self-Hosting Wren

Wren is [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html) licensed — you're free to run your own instance instead of using the hosted bot. This page walks through standing one up from source.

{% hint style="info" %}
This page is for **operators** running their own copy of the bot. If you're a server admin configuring an existing Wren instance (hosted or self-hosted) in your Discord server, see the [Configuration Guide](configuration.md) instead.
{% endhint %}

## Prerequisites

* **Node.js 20+**
* **PostgreSQL** — one database, all tables tenant-scoped by `guild_id`. Any reachable Postgres instance works (local, Railway, RDS, etc.).
* A **Discord application + bot token** from the [Discord Developer Portal](https://discord.com/developers/applications), with the **Message Content Intent** enabled.
* An **[OpenRouter](https://openrouter.ai/)** API key — Wren's model calls (chat + tool calling) go through OpenRouter.
* Optional: a **[Brave Search API](https://brave.com/search/api/)** key for web search fallback.

## 1. Clone and install

```bash
git clone https://github.com/<your-fork-or-org>/wren.git
cd wren
npm install
```

## 2. Configure environment variables

```bash
cp .env.example .env
```

Then fill in `.env`. The variables Wren actually reads, grouped by what they gate:

### Required to boot

| Key | Notes |
|---|---|
| `DISCORD_TOKEN` | Bot token from the Developer Portal. |
| `OPENROUTER_API_KEY` | https://openrouter.ai/ |
| `OPENROUTER_MODEL` | e.g. `mistralai/mistral-large-2411`. |
| `DATABASE_URL` | Postgres connection string. |
| `TENANT_SECRET_ENC_KEY` | Base64 of 32 random bytes — AES-256-GCM key used to encrypt per-tenant secrets (ERLC server key, POW token) at rest. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. |

Wren refuses to start if any of these are missing, or if `TENANT_SECRET_ENC_KEY` isn't a valid 32-byte base64 key.

### Optional — core

| Key | Default | Notes |
|---|---|---|
| `API_PORT` | `4167` | Port for the REST API (`POST /v1/chat`, `GET /v1/info`). |
| `BRAVE_SEARCH_API_KEY` | — | Without it, Wren's web-search fallback is disabled; RAG and everything else still works. |
| `ATRIA_STAFF_IDS` | — | Comma-separated Discord user IDs to grant `$atria` global admin commands, on top of the three IDs already hardcoded into `src/discord/atriaCommands.js`. |

### Optional — ERLC / PRC integration

Needed only if you want tenants to connect Wren to their Emergency Response: Liberty County server.

| Key | Default | Notes |
|---|---|---|
| `PRC_GLOBAL_KEY` | — | Global authorization key for the PRC API. Required at call time for **any** ERLC feature — if unset, ERLC-dependent commands throw a clear "operator misconfiguration" error rather than failing silently. |
| `PRC_BASE_URL` | `https://api.erlc.gg/v1` | Override if PRC ever changes endpoints. |
| `WREN_EGRESS_IP` | `152.53.21.47` (Atria's IP) | **You must override this.** Wren tells server owners to whitelist this IP in their ERLC dashboard during `/wren setup`. The default is Atria's own hosted IP — on a self-hosted instance it's wrong, and ERLC calls will fail until server owners whitelist the address your instance actually egresses from. |

{% hint style="danger" %}
If you skip `WREN_EGRESS_IP`, `/wren setup` will tell every server owner to whitelist an IP address that isn't yours. ERLC connections will silently fail until you fix it — set this before onboarding any real tenant.
{% endhint %}

### Optional — billing (Polar.sh)

Only relevant if you want to run paid subscription tiers through [Polar.sh](https://polar.sh/). Skip this section entirely for a free, unmetered self-hosted instance — none of these are read outside the `/wren upgrade` flow and the billing webhook.

| Key | Notes |
|---|---|
| `POLAR_ACCESS_TOKEN` | Polar API access token. |
| `POLAR_WEBHOOK_SECRET` | Validates incoming Polar webhooks. |
| `POLAR_CORE_PRODUCT_ID` / `POLAR_PRO_PRODUCT_ID` | Product IDs for your Polar-side plans. |

### Optional — observability

| Key | Notes |
|---|---|
| `POSTHOG_API_KEY` | Enables PostHog tracing/logging (see [Security & Data Privacy Overview](security-privacy-overview.md) for what's captured). Omit to run with tracing disabled. |

### Optional — Roblox account linking

| Key | Default | Notes |
|---|---|---|
| `BLOXLINK_API_KEY` | — | Enables Discord ↔ Roblox account resolution via [Bloxlink](https://blox.link/). Lookups are skipped (with a warning logged) if unset. |
| `BLOXLINK_BASE_URL` | `https://api.blox.link` | Override for a self-hosted Bloxlink proxy, if you run one. |

## 3. Set up the database

```bash
npm run migrate
```

This applies `src/db/schema.sql` against `DATABASE_URL`. It's idempotent, and `npm start` also runs it automatically on every boot — the manual command is mainly useful for a pre-flight check before you point the bot at a fresh database.

## 4. Run it

```bash
npm start        # node src/index.js
npm run dev       # same, with --watch for local development
```

On boot, Wren:

1. Loads and validates config (fails fast if required env vars are missing).
2. Applies pending migrations.
3. Connects to Discord, registers the `/wren` command set on every guild it's in, and starts the raid poller + in-game bridge.
4. Starts the REST API on `API_PORT`.

For a persistent process, run it under a process manager — `pm2`, `systemd`, or a container orchestrator all work fine; there's no framework-specific requirement. The repo's own [`deploy.sh`](../deploy.sh) is Atria's internal blue-green PM2 deployment script (interactive secret prompts, release symlinks, its own conventions) — treat it as a reference for one way to run this in production, not as the required or only path. A plain `Procfile`/systemd unit calling `npm start` is enough for most self-hosted setups.

## 5. Onboard a Discord server

Same flow as the hosted bot — see [Onboarding a new server](configuration.md#onboarding-a-new-server) in the Configuration Guide:

1. Invite your bot to a guild.
2. Run `/wren setup`.
3. Configure ERLC/POW keys, channels, roles, and sources via `/wren config` and `/wren sources`.
4. `/wren ingest run` to build the tenant's vector store.

## Updating

```bash
git pull
npm install
npm run migrate   # or just restart — migrations run on boot
```

Check `CHANGELOG`-worthy commits or release notes (if maintained) for anything that needs manual intervention, like schema changes that aren't pure additive migrations.

## Self-hosted vs. hosted

Running from source gets you the same bot Atria runs at `wren.atriasafety.org`, minus the parts that are specific to Atria's own hosted deployment:

* **Billing** (Polar) is entirely optional — omit the `POLAR_*` vars and the `/wren upgrade` flow simply won't be wired to a real payment processor.
* **Observability** (PostHog) is opt-in via `POSTHOG_API_KEY`.
* **Global staff commands** (`$atria`) include three IDs hardcoded in source (Atria's own staff) in addition to whatever you set in `ATRIA_STAFF_IDS` — see `src/discord/atriaCommands.js` if you need to know exactly who that is.
* You're responsible for your own uptime, backups, and Postgres maintenance — the hosted service's SLAs and the [Terms of Service](terms-of-service.md) / [Privacy Policy](privacy-policy.md) describe Atria's hosted offering specifically and don't apply to your own deployment.

## Troubleshooting

See the general [Troubleshooting](troubleshooting.md) guide for runtime error messages. Self-hosting-specific issues are almost always one of:

* **ERLC connections fail for every server:** check `WREN_EGRESS_IP` matches your instance's real outbound IP, and that `PRC_GLOBAL_KEY` is set.
* **Bot doesn't respond to mentions:** confirm Message Content Intent is enabled for your Discord application.
* **Boot fails immediately with "Missing required env vars":** see the required table above — all five must be set.
