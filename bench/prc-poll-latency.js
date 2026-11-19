import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';
import { closePool, getPool } from '../src/db/pool.js';
import { attachIngameBridge } from '../src/discord/ingameBridge.js';
import { encryptSecret } from '../src/tenant/crypto.js';
import { clearCache, setEncryptionKey } from '../src/tenant/resolve.js';

const db = new URL(process.env.BENCH_DATABASE_URL ?? 'postgresql://wren:wren@localhost:5432/wren');
const host = (db.searchParams.getAll('host').at(-1) || db.hostname).replace(/^\[(::1)\]$/, '$1');
assert(['postgres:', 'postgresql:'].includes(db.protocol) && ['localhost', '127.0.0.1', '::1'].includes(host),
  'Use a local development database');
db.searchParams.set('host', host);
const samples = Number(process.env.BENCH_SAMPLES ?? 40);
const prcMs = Number(process.env.BENCH_PRC_MS ?? 50);
const dbMs = Number(process.env.BENCH_DB_MS ?? 0);
assert(Number.isSafeInteger(samples) && samples >= 1 && prcMs >= 0 && dbMs >= 0);
const prc = 'https://93.184.216.34/v2'; // fetch is stubbed; no outbound requests
const schema = 'bench_prc_' + randomBytes(8).toString('hex');
const isolated = new URL(db);
isolated.searchParams.set('options', '-c search_path=' + schema);
const key = Buffer.alloc(32);
Object.assign(process.env, {
  DATABASE_URL: isolated.href, DISCORD_TOKEN: 'benchmark', OPENROUTER_API_KEY: 'benchmark',
  OPENROUTER_MODEL: 'benchmark', TENANT_SECRET_ENC_KEY: key.toString('base64'), PRC_GLOBAL_KEY: 'benchmark',
});
setEncryptionKey(key);

const sql = new pg.Client({ connectionString: db.href });
let schemaCreated = false;
const originalFetch = globalThis.fetch;
const stop = (signal) => { process.exitCode = signal === 'SIGINT' ? 130 : 143; };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  await sql.connect();
  await sql.query('CREATE SCHEMA ' + schema);
  schemaCreated = true;
  await runMigrations();
  const pool = getPool();
  await pool.query("INSERT INTO tenants (tenant_id, display_name) SELECT 'bench-' || i, 'Server ' || i FROM generate_series(1, 250) i");
  await pool.query('UPDATE tenants SET erlc_server_key_enc = $1, prc_base_url = $2 WHERE tenant_id = ANY($3)',
    [encryptSecret('fixture', key), prc, Array.from({ length: 12 }, (_, i) => 'bench-' + (i + 1))]);
  await pool.query("INSERT INTO tenant_sources (tenant_id, kind, ref) SELECT tenant_id, 'manual_doc', 'doc-' || i FROM tenants CROSS JOIN generate_series(1, 8) i");
  await pool.query("INSERT INTO tenant_memory (tenant_id, scope, content) SELECT tenant_id, 'server', 'Benchmark memo.' FROM tenants CROSS JOIN generate_series(1, 50)");
  await pool.query('ANALYZE tenants; ANALYZE tenant_sources; ANALYZE tenant_memory');
  let calls = 0;
  globalThis.fetch = async (input) => {
    assert.equal(input, prc + '/server?CommandLogs=true');
    await delay(prcMs);
    calls++;
    return Response.json({ CommandLogs: [] });
  };
  let queries = 0;
  const originalQuery = pool.query.bind(pool);
  pool.query = async (...args) => {
    queries++;
    if (dbMs) await delay(dbMs);
    return originalQuery(...args);
  };

  let sweep;
  const originalInterval = globalThis.setInterval;
  try {
    globalThis.setInterval = (fn, ms) => { if (ms === 30_000) sweep = fn; };
    attachIngameBridge();
  } finally {
    globalThis.setInterval = originalInterval;
  }
  assert(sweep);
  for (const cold of [true, false]) {
    if (process.exitCode) break;
    await sweep();
    const times = [];
    const counts = [];
    for (let i = 0; i < samples && !process.exitCode; i++) {
      if (cold) clearCache();
      queries = calls = 0;
      const start = performance.now();
      await sweep();
      times.push(performance.now() - start);
      assert.equal(calls, 12, 'each of the 12 keys should be polled');
      counts.push(queries);
    }
    if (process.exitCode) break;
    times.sort((a, b) => a - b);
    const pct = (p) => +times[Math.ceil(times.length * p) - 1].toFixed(2);
    console.log(cold ? 'cold' : 'warm', {
      samples, prcMs, dbMs, p50: pct(.5), p95: pct(.95), p99: pct(.99), sqlPerSweep: [...new Set(counts)],
    });
  }
} finally {
  globalThis.fetch = originalFetch;
  await closePool();
  if (schemaCreated) await sql.query('DROP SCHEMA ' + schema + ' CASCADE');
  await sql.end();
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
