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
  await pool.query(sql);
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