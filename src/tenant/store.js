import { withTx } from '../db/pool.js';
import { encryptSecret, decryptSecret } from './crypto.js';

const DEFAULT_POLICY = {
  ban_player: 'mod',
  kick_player: 'mod',
  kill_player: 'mod',
  tp_player: 'mod',
  send_pm: 'mod',
  mod_player: 'admin',
  unmod_player: 'admin',
  admin_player: 'admin',
  unadmin_player: 'admin',
  purge_messages: 'mod',
  bring_all_staff: 'admin',
  pm_all_staff: 'admin',
  log_punishment: 'mod',
  save_memory_server: 'mod',
  save_memory_user: 'user',
  get_server_stats: 'user',
  list_online_players: 'user',
  check_if_online: 'user',
  check_if_staff: 'user',
  get_player_info: 'user',
  get_all_channels: 'user',
  get_channel_messages: 'user',
  get_user_info: 'user',
  search_command_logs: 'user',
  lookup_roblox_profile: 'user',
  analyze_player_activity: 'user',
  summarize_chat: 'user',
  check_punishments: 'user',
  check_whitelist_status: 'user',
  check_player_perks: 'user',
  ingest_run: 'admin',
  api_issue: 'owner',
};

export function getDefaultPolicy() {
  return { ...DEFAULT_POLICY };
}

// ---------- tenants ----------

export async function createTenant({ tenantId, displayName, ownerDiscordId = null, encKey }) {
  return withTx(async (c) => {
    await c.query(
      `INSERT INTO tenants (tenant_id, display_name, owner_discord_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId, displayName, ownerDiscordId],
    );
    for (const [tool, minRole] of Object.entries(DEFAULT_POLICY)) {
      await c.query(
        `INSERT INTO tenant_role_policy (tenant_id, tool, min_role)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [tenantId, tool, minRole],
      );
    }
    return getTenant(tenantId, encKey);
  });
}

export async function getTenant(tenantId, encKey) {
  const { query } = await import('../db/pool.js');
  const r = await query(`SELECT * FROM tenants WHERE tenant_id = $1`, [tenantId]);
  if (!r.rows[0]) return null;
  return rowToTenant(r.rows[0], encKey);
}

export async function listTenants(encKey) {
  const { query } = await import('../db/pool.js');
  const r = await query(`SELECT * FROM tenants ORDER BY created_at`);
  return r.rows.map((row) => rowToTenant(row, encKey));
}

export async function updateTenant(tenantId, patch, encKey) {
  const fields = [];
  const values = [];
  let i = 1;
  const allowed = [
    'display_name','bot_display_name','in_game_handle','owner_discord_id',
    'prc_base_url','pow_base_url','pow_server_a_id','pow_server_b_id',
    'ticket_category_id','ticket_parent_id','security_role_id',
    'status_channel_id','erlc_log_channel_id','in_game_pm_log_id',
    'raid_alert_channel','raid_alert_role',
    'core_info','response_style','raid_auto_punish','extra_config',
  ];
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) continue;
    if (k === 'extra_config' && typeof v !== 'string') {
      fields.push(`${k} = $${i++}::jsonb`);
      values.push(JSON.stringify(v));
    } else {
      fields.push(`${k} = $${i++}`);
      values.push(v);
    }
  }
  if (!fields.length) return getTenant(tenantId, encKey);
  fields.push(`updated_at = NOW()`);
  values.push(tenantId);
  const { query } = await import('../db/pool.js');
  await query(`UPDATE tenants SET ${fields.join(', ')} WHERE tenant_id = $${i}`, values);
  return getTenant(tenantId, encKey);
}

export async function setTenantSecret(tenantId, field, plain, encKey) {
  if (!['erlc_server_key', 'pow_token'].includes(field)) {
    throw new Error(`unknown secret field: ${field}`);
  }
  const blob = encryptSecret(plain, encKey);
  const col = field === 'erlc_server_key' ? 'erlc_server_key_enc' : 'pow_token_enc';
  const { query } = await import('../db/pool.js');
  await query(`UPDATE tenants SET ${col} = $1, updated_at = NOW() WHERE tenant_id = $2`, [blob, tenantId]);
}

function rowToTenant(row, encKey) {
  const t = {
    tenantId: row.tenant_id,
    displayName: row.display_name,
    botDisplayName: row.bot_display_name,
    inGameHandle: row.in_game_handle,
    ownerDiscordId: row.owner_discord_id,
    prcBaseUrl: row.prc_base_url,
    powBaseUrl: row.pow_base_url,
    powServerAId: row.pow_server_a_id,
    powServerBId: row.pow_server_b_id,
    ticketCategoryId: row.ticket_category_id,
    ticketParentId: row.ticket_parent_id,
    securityRoleId: row.security_role_id,
    statusChannelId: row.status_channel_id,
    erlcLogChannelId: row.erlc_log_channel_id,
    inGamePmLogId: row.in_game_pm_log_id,
    raidAlertChannel: row.raid_alert_channel,
    raidAlertRole: row.raid_alert_role,
    coreInfo: row.core_info,
    responseStyle: row.response_style,
    raidAutoPunish: row.raid_auto_punish,
    extraConfig: row.extra_config || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (encKey) {
    if (row.erlc_server_key_enc) t.erlcServerKey = decryptSecret(row.erlc_server_key_enc, encKey);
    if (row.pow_token_enc) t.powToken = decryptSecret(row.pow_token_enc, encKey);
  }
  return t;
}

// ---------- sources ----------

export async function listSources(tenantId, { enabledOnly = false } = {}) {
  const { query } = await import('../db/pool.js');
  const r = await query(
    `SELECT * FROM tenant_sources WHERE tenant_id = $1 ${enabledOnly ? 'AND enabled' : ''} ORDER BY created_at`,
    [tenantId],
  );
  return r.rows.map(rowToSource);
}

export async function addSource({ tenantId, kind, ref, label = null, weight = 1.0 }) {
  const { query } = await import('../db/pool.js');
  await query(
    `INSERT INTO tenant_sources (tenant_id, kind, ref, label, weight)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, kind, ref) DO UPDATE SET label = EXCLUDED.label, weight = EXCLUDED.weight, enabled = TRUE`,
    [tenantId, kind, ref, label, weight],
  );
}

export async function removeSource({ tenantId, kind, ref }) {
  const { query } = await import('../db/pool.js');
  await query(
    `DELETE FROM tenant_sources WHERE tenant_id = $1 AND kind = $2 AND ref = $3`,
    [tenantId, kind, ref],
  );
}

export async function setSourceEnabled({ tenantId, kind, ref, enabled }) {
  const { query } = await import('../db/pool.js');
  await query(
    `UPDATE tenant_sources SET enabled = $1 WHERE tenant_id = $2 AND kind = $3 AND ref = $4`,
    [enabled, tenantId, kind, ref],
  );
}

export async function markSourceIngested({ tenantId, kind, ref }) {
  const { query } = await import('../db/pool.js');
  await query(
    `UPDATE tenant_sources SET last_ingested_at = NOW() WHERE tenant_id = $1 AND kind = $2 AND ref = $3`,
    [tenantId, kind, ref],
  );
}

function rowToSource(row) {
  return {
    kind: row.kind,
    ref: row.ref,
    label: row.label,
    weight: Number(row.weight),
    enabled: row.enabled,
    lastIngestedAt: row.last_ingested_at,
  };
}

// ---------- role policy ----------

export async function getPolicy(tenantId) {
  const { query } = await import('../db/pool.js');
  const r = await query(`SELECT tool, min_role FROM tenant_role_policy WHERE tenant_id = $1`, [tenantId]);
  const map = {};
  for (const row of r.rows) map[row.tool] = row.min_role;
  return map;
}

export async function setPolicyEntry({ tenantId, tool, minRole }) {
  const { query } = await import('../db/pool.js');
  await query(
    `INSERT INTO tenant_role_policy (tenant_id, tool, min_role) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, tool) DO UPDATE SET min_role = EXCLUDED.min_role`,
    [tenantId, tool, minRole],
  );
}

// ---------- role slot mapping ----------

export async function getRoleSlots(tenantId) {
  const { query } = await import('../db/pool.js');
  const r = await query(`SELECT slot, role_id FROM tenant_roles WHERE tenant_id = $1`, [tenantId]);
  const map = {};
  for (const row of r.rows) map[row.slot] = row.role_id;
  return map;
}

export async function setRoleSlot({ tenantId, slot, roleId }) {
  const { query } = await import('../db/pool.js');
  await query(
    `INSERT INTO tenant_roles (tenant_id, slot, role_id) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, slot) DO UPDATE SET role_id = EXCLUDED.role_id`,
    [tenantId, slot, roleId],
  );
}

export async function removeRoleSlot({ tenantId, slot }) {
  const { query } = await import('../db/pool.js');
  await query(`DELETE FROM tenant_roles WHERE tenant_id = $1 AND slot = $2`, [tenantId, slot]);
}

// ---------- bans ----------

export async function listBans(tenantId) {
  const { query } = await import('../db/pool.js');
  const r = await query(
    `SELECT user_key, reason, banned_by, created_at FROM tenant_bans WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
  );
  return r.rows;
}

export async function isBanned(tenantId, userKey) {
  const { query } = await import('../db/pool.js');
  const r = await query(
    `SELECT 1 FROM tenant_bans WHERE tenant_id = $1 AND user_key = $2`,
    [tenantId, userKey],
  );
  return r.rowCount > 0;
}

export async function addBan({ tenantId, userKey, reason = null, bannedBy = null }) {
  const { query } = await import('../db/pool.js');
  await query(
    `INSERT INTO tenant_bans (tenant_id, user_key, reason, banned_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, user_key) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by`,
    [tenantId, userKey, reason, bannedBy],
  );
}

export async function removeBan({ tenantId, userKey }) {
  const { query } = await import('../db/pool.js');
  await query(`DELETE FROM tenant_bans WHERE tenant_id = $1 AND user_key = $2`, [tenantId, userKey]);
}

// ---------- memory ----------

export async function listMemory(tenantId, { scope = null, userKey = null, limit = 200 } = {}) {
  const { query } = await import('../db/pool.js');
  const clauses = ['tenant_id = $1'];
  const values = [tenantId];
  if (scope) { values.push(scope); clauses.push(`scope = $${values.length}`); }
  if (userKey) { values.push(userKey); clauses.push(`user_key = $${values.length}`); }
  values.push(limit);
  const r = await query(
    `SELECT id, scope, user_key, content, added_by, created_at FROM tenant_memory
     WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT $${values.length}`,
    values,
  );
  return r.rows;
}

export async function addMemory({ tenantId, scope, userKey = null, content, addedBy = null }) {
  const { query } = await import('../db/pool.js');
  const r = await query(
    `INSERT INTO tenant_memory (tenant_id, scope, user_key, content, added_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, scope, userKey, content, addedBy],
  );
  return r.rows[0].id;
}

export async function removeMemory(tenantId, id) {
  const { query } = await import('../db/pool.js');
  await query(`DELETE FROM tenant_memory WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
}

// ---------- processed events (idempotency) ----------

export async function tryClaimEvent({ tenantId, eventId, ttlSeconds }) {
  const { query } = await import('../db/pool.js');
  const r = await query(
    `INSERT INTO processed_events (tenant_id, event_id, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval)
     ON CONFLICT (tenant_id, event_id) DO NOTHING
     RETURNING event_id`,
    [tenantId, eventId, String(ttlSeconds)],
  );
  return r.rowCount > 0;
}

export async function pruneExpiredEvents() {
  const { query } = await import('../db/pool.js');
  await query(`DELETE FROM processed_events WHERE expires_at < NOW()`);
}

// ---------- raid events ----------

export async function pushRaidEvent({ tenantId, playerId, command, logTs, targetCount, windowMs }) {
  const { query } = await import('../db/pool.js');
  await query(
    `INSERT INTO raid_events (tenant_id, player_id, command, log_ts, added_at, target_count)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, playerId, command, logTs, Date.now(), targetCount],
  );
  await query(
    `DELETE FROM raid_events WHERE tenant_id = $1 AND player_id = $2 AND added_at < $3`,
    [tenantId, playerId, Date.now() - windowMs],
  );
}

export async function recentRaidEvents({ tenantId, playerId, windowMs }) {
  const { query } = await import('../db/pool.js');
  const r = await query(
    `SELECT command, log_ts, target_count FROM raid_events
     WHERE tenant_id = $1 AND player_id = $2 AND added_at >= $3`,
    [tenantId, playerId, Date.now() - windowMs],
  );
  return r.rows;
}

export async function clearRaidHistory(playerId, tenantId) {
  const { query } = await import('../db/pool.js');
  await query(`DELETE FROM raid_events WHERE tenant_id = $1 AND player_id = $2`, [tenantId, playerId]);
}

// ---------- processed tickets ----------

export async function markTicketProcessed({ tenantId, channelId }) {
  const { query } = await import('../db/pool.js');
  await query(
    `INSERT INTO processed_tickets (tenant_id, channel_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [tenantId, channelId],
  );
}

export async function isTicketProcessed({ tenantId, channelId }) {
  const { query } = await import('../db/pool.js');
  const r = await query(
    `SELECT 1 FROM processed_tickets WHERE tenant_id = $1 AND channel_id = $2`,
    [tenantId, channelId],
  );
  return r.rowCount > 0;
}

// ---------- audit log ----------

export async function audit({ tenantId, actor, action, target = null, metadata = null }) {
  const { query } = await import('../db/pool.js');
  await query(
    `INSERT INTO audit_log (tenant_id, actor, action, target, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [tenantId, actor, action, target, metadata ? JSON.stringify(metadata) : null],
  );
}

// ---------- API tokens ----------

export async function issueApiToken({ tenantId, tokenHash, label = null, scopes = ['chat'] }) {
  const { query } = await import('../db/pool.js');
  await query(
    `INSERT INTO tenant_api_tokens (tenant_id, token_hash, label, scopes)
     VALUES ($1, $2, $3, $4)`,
    [tenantId, tokenHash, label, scopes],
  );
}

export async function findTenantByTokenHash(tokenHash) {
  const { query } = await import('../db/pool.js');
  const r = await query(
    `SELECT t.tenant_id AS tenant_id, tok.scopes AS scopes, tok.token_hash AS token_hash
     FROM tenant_api_tokens tok
     JOIN tenants t ON t.tenant_id = tok.tenant_id
     WHERE tok.token_hash = $1 AND tok.revoked_at IS NULL`,
    [tokenHash],
  );
  if (!r.rows[0]) return null;
  await query(
    `UPDATE tenant_api_tokens SET last_used_at = NOW() WHERE token_hash = $1`,
    [tokenHash],
  );
  return {
    tenantId: r.rows[0].tenant_id,
    scopes: r.rows[0].scopes || [],
    tokenHash: r.rows[0].token_hash,
  };
}

export async function revokeApiToken({ tenantId, tokenHash }) {
  const { query } = await import('../db/pool.js');
  await query(
    `UPDATE tenant_api_tokens SET revoked_at = NOW() WHERE tenant_id = $1 AND token_hash = $2`,
    [tenantId, tokenHash],
  );
}