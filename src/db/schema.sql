-- Wren multi-tenant schema
-- All tables carry tenant_id with leading-composite indexes for query speed.

CREATE TABLE IF NOT EXISTS tenants (
  tenant_id           TEXT PRIMARY KEY,
  display_name        TEXT NOT NULL,
  bot_display_name    TEXT NOT NULL DEFAULT 'Wren',
  in_game_handle      TEXT NOT NULL DEFAULT ':pm wren',
  owner_discord_id    TEXT,
  erlc_server_key_enc BYTEA,
  prc_base_url        TEXT NOT NULL DEFAULT 'https://api.erlc.gg/v1',
  pow_base_url        TEXT,
  pow_token_enc       BYTEA,
  pow_server_id       TEXT,
  ticket_autoresponder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ticket_category_id  TEXT,
  ticket_parent_id    TEXT,
  leadership_role_id  TEXT,
  admin_role_id       TEXT,
  mod_role_id         TEXT,
  status_channel_id   TEXT,
  erlc_log_channel_id TEXT,
  in_game_pm_log_id   TEXT,
  raid_alert_channel  TEXT,
  raid_alert_role     TEXT,
  core_info           TEXT NOT NULL DEFAULT '',
  response_style      TEXT NOT NULL DEFAULT '',
  raid_auto_punish    BOOLEAN NOT NULL DEFAULT TRUE,
  extra_config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS tenant_sources (
  tenant_id  TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('discord_channel','website','manual_doc')),
  ref        TEXT NOT NULL,
  label      TEXT,
  weight     REAL NOT NULL DEFAULT 1.0,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  last_ingested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_tenant_sources_tenant ON tenant_sources(tenant_id) WHERE enabled;

CREATE TABLE IF NOT EXISTS tenant_role_policy (
  tenant_id  TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  tool       TEXT NOT NULL,
  min_role   TEXT NOT NULL CHECK (min_role IN ('owner','leadership','admin','mod','user')),
  PRIMARY KEY (tenant_id, tool)
);
CREATE INDEX IF NOT EXISTS idx_tenant_role_policy_tenant ON tenant_role_policy(tenant_id);

CREATE TABLE IF NOT EXISTS tenant_roles (
  tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  slot      TEXT NOT NULL,
  role_id   TEXT NOT NULL,
  PRIMARY KEY (tenant_id, slot)
);

CREATE TABLE IF NOT EXISTS tenant_bans (
  tenant_id  TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  user_key   TEXT NOT NULL,
  reason     TEXT,
  banned_by  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_key)
);
CREATE INDEX IF NOT EXISTS idx_tenant_bans_tenant ON tenant_bans(tenant_id);

CREATE TABLE IF NOT EXISTS tenant_memory (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  scope      TEXT NOT NULL CHECK (scope IN ('server','user')),
  user_key   TEXT,
  content    TEXT NOT NULL,
  added_by   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenant_memory_tenant ON tenant_memory(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memory_lookup ON tenant_memory(tenant_id, scope, user_key);

CREATE TABLE IF NOT EXISTS processed_events (
  tenant_id   TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_processed_events_expiry ON processed_events(expires_at);

CREATE TABLE IF NOT EXISTS raid_events (
  tenant_id     TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  player_id     TEXT NOT NULL,
  command       TEXT NOT NULL,
  log_ts        BIGINT NOT NULL,
  added_at      BIGINT NOT NULL,
  target_count  INT NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, player_id, log_ts, command)
);
CREATE INDEX IF NOT EXISTS idx_raid_events_tenant ON raid_events(tenant_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_time ON audit_log(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_api_tokens (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  label       TEXT,
  scopes      TEXT[] NOT NULL DEFAULT ARRAY['chat']::TEXT[],
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tenant_api_tokens_tenant ON tenant_api_tokens(tenant_id);

CREATE TABLE IF NOT EXISTS processed_tickets (
  tenant_id   TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, channel_id)
);

-- Migrations for existing databases (idempotent)
DO $$ BEGIN
  ALTER TABLE tenants ADD COLUMN staff_role_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE tenants ADD COLUMN admin_role_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE tenants ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE tenants ADD COLUMN monthly_message_count INT NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE tenants ADD COLUMN billing_cycle_reset TIMESTAMPTZ NOT NULL DEFAULT (NOW() + interval '1 month');
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE tenants ADD COLUMN polar_subscription_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE tenants ADD COLUMN subscription_owner_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE tenants ADD COLUMN polar_customer_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE tenants ADD COLUMN last_active_channel_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE tenants ADD COLUMN monthly_voice_time_seconds INT NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE tenants ADD COLUMN ticket_autoresponder_enabled BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE tenants ADD COLUMN erlc_authorized BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS user_agreements (
  discord_id TEXT PRIMARY KEY,
  agreed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS global_bans (
  discord_id TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS global_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Permanent cache of a Discord staff member's verified Roblox account, per tenant.
-- Verified once via POW's /members/lookup (their POW staff record's linked Discord
-- ID must match), then reused for every subsequent log_punishment without re-asking.
CREATE TABLE IF NOT EXISTS tenant_staff_links (
  tenant_id       TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  discord_id      TEXT NOT NULL,
  roblox_user_id  TEXT NOT NULL,
  roblox_username TEXT,
  verified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, discord_id)
);

CREATE TABLE IF NOT EXISTS user_mcp_tokens (
  token_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  discord_id  TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  UNIQUE(tenant_id, discord_id)
);

DO $$ BEGIN
  ALTER TABLE tenants RENAME COLUMN pow_server_a_id TO pow_server_id;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

-- Backfill policy rows added after tenants were created (idempotent).
INSERT INTO tenant_role_policy (tenant_id, tool, min_role)
  SELECT tenant_id, 'delete_memory_server', 'leadership' FROM tenants
  ON CONFLICT DO NOTHING;
INSERT INTO tenant_role_policy (tenant_id, tool, min_role)
  SELECT tenant_id, 'delete_memory_user', 'user' FROM tenants
  ON CONFLICT DO NOTHING;
INSERT INTO tenant_role_policy (tenant_id, tool, min_role)
  SELECT tenant_id, 'read_webpage', 'user' FROM tenants
  ON CONFLICT DO NOTHING;
INSERT INTO tenant_role_policy (tenant_id, tool, min_role)
  SELECT tenant_id, 'search_web', 'user' FROM tenants
  ON CONFLICT DO NOTHING;
