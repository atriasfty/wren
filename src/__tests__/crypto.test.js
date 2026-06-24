import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { encryptSecret, decryptSecret, hashToken, generateApiToken } from '../tenant/crypto.js';

const KEY = crypto.randomBytes(32);

describe('crypto', () => {
  it('round-trips encrypt/decrypt', () => {
    const plain = 'sample-secret-token-value-for-round-trip-test';
    const blob = encryptSecret(plain, KEY);
    expect(decryptSecret(blob, KEY)).toBe(plain);
  });

  it('rejects a tampered ciphertext (auth tag fails)', () => {
    const blob = encryptSecret('hello', KEY);
    blob[blob.length - 1] ^= 0xff;
    expect(() => decryptSecret(blob, KEY)).toThrow();
  });

  it('rejects with a wrong key', () => {
    const blob = encryptSecret('hello', KEY);
    const otherKey = crypto.randomBytes(32);
    expect(() => decryptSecret(blob, otherKey)).toThrow();
  });

  it('produces a different IV each call (distinct ciphertexts)', () => {
    const a = encryptSecret('same', KEY);
    const b = encryptSecret('same', KEY);
    expect(a.equals(b)).toBe(false);
  });

  it('hashToken is deterministic hex sha256', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generateApiToken has the expected prefix', () => {
    const t = generateApiToken();
    expect(t.startsWith('wren_')).toBe(true);
  });
});
