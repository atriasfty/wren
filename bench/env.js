// Must be the first import of the CLI. src/config.js refuses to load without
// production env vars, but the bench never touches Discord, the DB, or tenant
// secrets — so load .env if present, then fill anything missing with inert
// placeholders before any src/ module is evaluated.
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// bench/.env first (WRENBENCH_API_KEY etc.), then the app's .env; dotenv never
// overrides a variable that is already set.
dotenv.config({ path: path.join(root, 'bench', '.env'), quiet: true });
dotenv.config({ path: path.join(root, '.env'), quiet: true });

const placeholders = {
  DISCORD_TOKEN: 'wrenbench-placeholder',
  OPENROUTER_API_KEY: 'wrenbench-placeholder',
  OPENROUTER_MODEL: 'wrenbench-placeholder',
  DATABASE_URL: 'postgres://wrenbench-placeholder/none',
  TENANT_SECRET_ENC_KEY: Buffer.alloc(32).toString('base64'),
};
for (const [k, v] of Object.entries(placeholders)) {
  if (!process.env[k]) process.env[k] = v;
}
