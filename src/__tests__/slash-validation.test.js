import { describe, it, expect } from 'vitest';
import { SETTABLE_KEYS_FOR_TEST as SETTABLE_KEYS } from '../slash/validation.js';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const handlersSrc = readFileSync(path.join(here, '..', 'slash', 'handlers.js'), 'utf8');

describe('slash validation', () => {
  it('only allows settable config keys', () => {
    for (const k of ['password', 'erlc_server_key_enc', 'pow_token_enc', 'arbitrary_field']) {
      expect(SETTABLE_KEYS.has(k)).toBe(false);
    }
    for (const k of ['displayName', 'coreInfo', 'responseStyle', 'botDisplayName']) {
      expect(SETTABLE_KEYS.has(k)).toBe(true);
    }
  });

  it('handlers.js does not expose a setter for encrypted secret columns', () => {
    expect(handlersSrc).not.toMatch(/erlc_server_key_enc|pow_token_enc/);
  });
});
