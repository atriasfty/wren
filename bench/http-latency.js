// Node 22+ and a local Postgres role with permission to create a schema.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { createApiServer } from '../src/api/server.js';
import { getPool, closePool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashToken } from '../src/tenant/crypto.js';
import { resolveTenantById } from '../src/tenant/resolve.js';
import { embedText } from '../src/rag/embed.js';
import { retrieveSources } from '../src/rag/retrieve.js';
import { readVectorStore } from '../src/rag/store.js';

const db = new URL(process.env.BENCH_DATABASE_URL ?? 'postgresql://wren:wren@localhost:5432/wren');
assert(['localhost', '127.0.0.1', '[::1]'].includes(db.hostname), 'Use a local development database');
const schema = 'latency_' + randomBytes(8).toString('hex');
const isolated = new URL(db);
isolated.searchParams.set('options', '-c search_path=' + schema);
Object.assign(process.env, {
  DATABASE_URL: isolated.href, DISCORD_TOKEN: 'benchmark', OPENROUTER_API_KEY: 'benchmark',
  OPENROUTER_MODEL: 'benchmark', TENANT_SECRET_ENC_KEY: Buffer.alloc(32).toString('base64'),
});
const n = Number(process.env.BENCH_SAMPLES ?? 120);
const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 4);
const chunkCount = Number(process.env.BENCH_CHUNKS ?? 3000);
const llmMs = Number(process.env.BENCH_LLM_MS ?? 500);
assert(Number.isInteger(n) && n >= 1 && Number.isInteger(concurrency) && concurrency >= 1);
assert(Number.isInteger(chunkCount) && chunkCount >= 0 && Number.isFinite(llmMs) && llmMs >= 0);

const question = 'Where are the server rules for joining a roleplay scene?';
const tenant = 'bench-1';
const path = 'data/tenants/' + tenant + '/vector-store.json';
const directory = await mkdtemp(tmpdir() + '/wren-latency-');
const cwd = process.cwd();
const sql = new pg.Client({ connectionString: db.href });
let server;
let schemaCreated = false;

async function sample(label, fn, lanes = concurrency) {
  await Promise.all(Array.from({ length: lanes }, (_, i) => fn(i)));
  const times = [];
  let next = lanes;
  await Promise.all(Array.from({ length: lanes }, async () => {
    for (let i; (i = next++) < n + lanes;) {
      const start = performance.now();
      await fn(i);
      times.push(performance.now() - start);
    }
  }));
  times.sort((a, b) => a - b);
  const pct = (p) => +times[Math.ceil(p * times.length) - 1].toFixed(2);
  console.log(label, JSON.stringify({ n: times.length, p50: pct(.50), p95: pct(.95), p99: pct(.99) }));
}

async function seedCorpus() {
  await mkdir('data/tenants/' + tenant, { recursive: true });
  const vector = await embedText(question);
  let seed = 42;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const chunks = Array.from({ length: chunkCount }, (_, i) => ({
    id: i, sourceKind: 'manual_doc', sourceRef: 'doc-' + (i % 8),
    text: ('Server rules: join a scene only after checking with its roleplay participants. ').repeat(6) + i,
    embedding: vector.map((v) => v + (random() - .5) * .12),
  }));
  await writeFile(path, JSON.stringify({ metadata: {}, chunks }));
}

try {
  await sql.connect();
  await sql.query('CREATE SCHEMA ' + schema);
  schemaCreated = true;
  await runMigrations();
  const pool = getPool();
  await pool.query("INSERT INTO tenants (tenant_id, display_name, subscription_tier) SELECT 'bench-' || i, 'Server ' || i, 'pro' FROM generate_series(1, 250) i");
  await pool.query("INSERT INTO tenant_memory (tenant_id, scope, content) SELECT tenant_id, 'server', 'Moderation policy memo.' FROM tenants CROSS JOIN generate_series(1, 50)");
  await pool.query("INSERT INTO tenant_sources (tenant_id, kind, ref) SELECT tenant_id, 'manual_doc', 'doc-' || i FROM tenants CROSS JOIN generate_series(0, 7) i");
  const hashes = Array.from({ length: n + concurrency }, (_, i) => hashToken('rest-' + i));
  await pool.query('INSERT INTO tenant_api_tokens (tenant_id, token_hash) SELECT $1, unnest($2::text[])', [tenant, hashes]);
  await pool.query('ANALYZE tenants; ANALYZE tenant_memory; ANALYZE tenant_sources; ANALYZE tenant_api_tokens');

  process.chdir(directory);
  await seedCorpus();
  console.log(JSON.stringify({ samples: n, concurrency, chunkCount, llmMs, node: process.version }));

  const fetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(input instanceof Request ? input.url : input).hostname, 'openrouter.ai');
    const { messages } = JSON.parse(init.body);
    assert.equal(messages.at(-1).role, 'user');
    if (chunkCount) assert(messages.at(-1).content.some((part) => part.text.includes('RELEVANT KNOWLEDGE')));
    await delay(llmMs);
    return Response.json({ choices: [{ message: { content: 'benchmark answer' } }] });
  };

  const app = await createApiServer(null);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const ctx = await resolveTenantById(tenant);
  await sample('POST /v1/chat', async (i) => {
    const res = await fetch(base + '/v1/chat', {
      method: 'POST', headers: { Authorization: 'Bearer rest-' + i, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { text: 'benchmark answer', error: null });
  });
  await sample('RAG retrieveSources', () => retrieveSources(ctx, question, 6));
  await sample('RAG vector store read (warm file)', () => readVectorStore(path, { cache: true }), 1);
} finally {
  if (server) {
    server.close();
    server.closeAllConnections();
  }
  await closePool();
  if (schemaCreated) await sql.query('DROP SCHEMA ' + schema + ' CASCADE');
  await sql.end();
  process.chdir(cwd);
  await rm(directory, { recursive: true, force: true });
}
