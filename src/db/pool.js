import pg from 'pg';
import { dbQueryDuration } from '../metrics.js';

const { Pool } = pg;

let pool = null;
let closed = false;

export function getPool() {
  if (pool) return pool;
  // After shutdown, don't silently spin up a fresh pool for a late query.
  if (closed) throw new Error('DB pool is closed');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message);
  });
  return pool;
}

export async function query(text, params) {
  const start = Date.now();
  try {
    return await getPool().query(text, params);
  } finally {
    dbQueryDuration.observe((Date.now() - start) / 1000);
  }
}

export async function withTx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    client.release();
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
      client.release();
    } catch (rollbackErr) {
      // The connection itself is broken — evict it instead of returning it
      // to the pool, and surface the original error, not the rollback one.
      client.release(rollbackErr);
    }
    throw err;
  }
}

export async function closePool() {
  closed = true;
  if (pool) {
    await pool.end();
    pool = null;
  }
}