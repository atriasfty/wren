import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

export function encryptSecret(plain, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('encryption key must be a 32-byte Buffer');
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

export function decryptSecret(blob, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('encryption key must be a 32-byte Buffer');
  }
  if (!Buffer.isBuffer(blob) || blob.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('ciphertext too short');
  }
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateApiToken() {
  return 'wren_' + crypto.randomBytes(24).toString('base64url');
}