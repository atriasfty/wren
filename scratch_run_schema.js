import { query } from './src/db/pool.js';
import fs from 'fs';

async function run() {
  const sql = fs.readFileSync('./src/db/schema.sql', 'utf8');
  await query(sql);
  console.log('Schema updated.');
  process.exit(0);
}
run();
