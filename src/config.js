import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const REQUIRED = ['DISCORD_TOKEN', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'DATABASE_URL', 'TENANT_SECRET_ENC_KEY'];

let _config = null;

export function loadConfig() {
  if (_config) return _config;
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  const encKey = process.env.TENANT_SECRET_ENC_KEY;
  if (!/^[A-Za-z0-9+/=]+$/.test(encKey) || Buffer.from(encKey, 'base64').length !== 32) {
    throw new Error('TENANT_SECRET_ENC_KEY must be base64 of 32 raw bytes (AES-256 key)');
  }
  _config = {
    discordToken: process.env.DISCORD_TOKEN,
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    openRouterModel: process.env.OPENROUTER_MODEL,
    braveApiKey: process.env.BRAVE_SEARCH_API_KEY || null,
    databaseUrl: process.env.DATABASE_URL,
    tenantSecretEncKey: Buffer.from(encKey, 'base64'),
    apiPort: Number(process.env.API_PORT || 4167),
    nodeEnv: process.env.NODE_ENV || 'development',
  };
  return _config;
}