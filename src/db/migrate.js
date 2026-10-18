import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getPool, closePool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

export async function runMigrations() {
  const sqlPath = path.join(__dirname, 'schema.sql');
  const sql = await fs.readFile(sqlPath, 'utf-8');
  const pool = getPool();
  // Serialise concurrent boots (rolling deploys, two instances) — racing
  // CREATE/ALTER statements can fail with catalog unique violations.
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['wren_schema_migration']);
    try {
      await client.query(sql);
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['wren_schema_migration']).catch(() => {});
    }
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(async () => {
      console.log('✓ schema applied');
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ migration failed:', err);
      await closePool();
      process.exit(1);
    });
}