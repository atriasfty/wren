import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { createApiServer } from '../src/api/server.js';
import { runMigrations } from '../src/db/migrate.js';
import { closePool, query } from '../src/db/pool.js';

const db = new URL(process.env.BENCH_DATABASE_URL ?? 'postgresql://wren:wren@localhost:5432/wren');
const host = (db.searchParams.get('host') || db.hostname).replace(/^\[(::1)\]$/, '$1');
assert(['postgres:', 'postgresql:'].includes(db.protocol) && ['localhost', '127.0.0.1', '::1'].includes(host),
  'Use a local development database');
db.searchParams.set('host', host);
const schema = 'bench_polar_' + randomBytes(8).toString('hex');
const isolated = new URL(db);
isolated.searchParams.set('options', '-c search_path=' + schema);
const secret = 'benchmark-only';
Object.assign(process.env, {
  DATABASE_URL: isolated.href, DISCORD_TOKEN: 'benchmark', OPENROUTER_API_KEY: 'benchmark',
  OPENROUTER_MODEL: 'benchmark', TENANT_SECRET_ENC_KEY: Buffer.alloc(32).toString('base64'),
  POLAR_WEBHOOK_SECRET: secret, POLAR_CORE_PRODUCT_ID: 'benchmark-product',
});

function event(type, tenantId, id) {
  const timestamp = new Date().toISOString();
  const common = { created_at: timestamp, modified_at: null, metadata: {}, organization_id: 'bench-org' };
  return JSON.stringify({
    type, timestamp, data: {
      id, ...common, amount: 500, currency: 'usd', recurring_interval: 'month', recurring_interval_count: 1,
      status: 'active', current_period_start: timestamp, current_period_end: timestamp,
      trial_start: null, trial_end: null, cancel_at_period_end: false, canceled_at: null, started_at: timestamp,
      ends_at: null, ended_at: null, customer_id: 'bench-customer', product_id: 'benchmark-product',
      discount_id: null, checkout_id: null, customer_cancellation_reason: null, customer_cancellation_comment: null,
      metadata: { tenantId },
      customer: { ...common, id: 'bench-customer', email_verified: true, type: 'individual', name: null,
        billing_address: null, tax_id: null, deleted_at: null, avatar_url: 'https://example.test/avatar' },
      product: { ...common, id: 'benchmark-product', name: 'Core', description: null, visibility: 'public',
        trial_interval: null, trial_interval_count: null, recurring_interval: 'month', recurring_interval_count: 1,
        is_recurring: true, is_archived: false,
        prices: [], benefits: [], medias: [], attached_custom_fields: [] },
      discount: null, prices: [], meters: [], pending_update: null,
    },
  });
}

const sql = new pg.Client({ connectionString: db.href });
let server;
let schemaCreated = false;
let sends = 0;
const stop = (signal) => { process.exitCode = signal === 'SIGINT' ? 130 : 143; };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  await sql.connect();
  await sql.query('CREATE SCHEMA ' + schema);
  schemaCreated = true;
  await runMigrations();
  await query("INSERT INTO tenants (tenant_id, display_name, status_channel_id) SELECT 'bench-' || i, 'Server ' || i, 'status' FROM generate_series(0, 249) i");
  await query("UPDATE tenants SET subscription_tier = 'core', polar_subscription_id = 'existing' WHERE tenant_id = 'bench-249'");
  await query("INSERT INTO tenant_sources (tenant_id, kind, ref) SELECT tenant_id, 'manual_doc', 'doc-' || i FROM tenants CROSS JOIN generate_series(0, 7) i");
  await query("INSERT INTO tenant_memory (tenant_id, scope, content) SELECT tenant_id, 'server', 'Benchmark memo.' FROM tenants CROSS JOIN generate_series(1, 50)");
  const discord = { guilds: { fetch: async () => ({
    channels: { fetch: async () => {
      await delay(50);
      return { send: async () => { await delay(80); sends++; } };
    } },
  }) } };
  const app = await createApiServer(discord);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port + '/webhooks/polar';
  for (const kind of ['renewal', 'new purchase']) {
    if (process.exitCode) break;
    const times = [];
    sends = 0;
    async function run(i, record) {
      const body = kind === 'renewal' ? event('subscription.updated', 'bench-249', 'existing')
        : event('subscription.created', 'bench-' + i, 'new-' + i);
      const id = kind.replace(' ', '-') + '-' + i;
      const ts = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', secret).update(id + '.' + ts + '.' + body).digest('base64');
      const start = performance.now();
      const res = await fetch(url, {
        method: 'POST', body, headers: { 'Content-Type': 'application/json', 'webhook-id': id,
          'webhook-timestamp': String(ts), 'webhook-signature': 'v1,' + signature },
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
      if (record) times.push(performance.now() - start);
    }
    await Promise.all(Array.from({ length: 4 }, (_, i) => run(i, false)));
    const warmupSends = sends;
    let next = 4;
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let i; !process.exitCode && (i = next++) < 124;) await run(i, true);
    }));
    if (process.exitCode) break;
    times.sort((a, b) => a - b);
    const pct = (p) => +times[Math.ceil(times.length * p) - 1].toFixed(2);
    console.log(kind, { n: times.length, p50: pct(.5), p95: pct(.95), p99: pct(.99), notifications: sends - warmupSends });
  }
} finally {
  if (server) {
    server.close();
    server.closeAllConnections();
  }
  await closePool();
  if (schemaCreated) await sql.query('DROP SCHEMA ' + schema + ' CASCADE');
  await sql.end();
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
