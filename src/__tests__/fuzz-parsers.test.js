import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { chunkText } from '../rag/ingest.js';
import { splitForDiscord } from '../discord/messageHandler.js';
import { parseDurationMs } from '../discord/atriaCommands.js';

// Property-based fuzzing for the codebase's pure text-parsing functions.
// These take untrusted input (Discord message content, RAG source text,
// staff-command arguments) and are exactly the kind of code where boundary
// values (size=0, limit=0, non-numeric input) hide hangs/crashes that
// example-based tests won't stumble into by chance.
//
// Two of these properties previously failed against the pre-fix code:
//   - chunkText(text, 0)        -> crashed via array-length overflow after
//                                  pegging the event loop (RangeError)
//   - splitForDiscord(text, 0)  -> hung forever (had to be killed externally)
// Both are now guarded; the "never hangs" properties below are the
// regression tests for that fix.

describe('chunkText fuzzing', () => {
  it('never hangs/crashes for arbitrary text with the default size/overlap', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 5000 }), (text) => {
        const result = chunkText(text);
        expect(Array.isArray(result)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('never hangs/crashes for arbitrary size/overlap, including zero, negative, and non-finite values', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 1000 }),
        fc.oneof(
          fc.integer({ min: -10, max: 3000 }),
          fc.constant(0),
          fc.constant(NaN),
          fc.constant(Infinity),
          fc.constant(-Infinity),
        ),
        fc.oneof(
          fc.integer({ min: -10, max: 1500 }),
          fc.constant(NaN),
          fc.constant(-1),
        ),
        (text, size, overlap) => {
          const result = chunkText(text, size, overlap);
          expect(Array.isArray(result)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('regression: size=0 with long unbroken text terminates quickly instead of pegging the CPU', () => {
    const start = Date.now();
    const longText = 'a very long sentence with no punctuation that just keeps going without any period to stop it '.repeat(50);
    const result = chunkText(longText, 0);
    expect(Array.isArray(result)).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('every returned chunk is non-empty and longer than the 50-char floor', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 200, maxLength: 2000 }), (text) => {
        const chunks = chunkText(text);
        for (const c of chunks) {
          expect(c.length).toBeGreaterThan(50);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('returns [] for empty/falsy input without throwing', () => {
    for (const input of ['', null, undefined, 0, false]) {
      expect(chunkText(input)).toEqual([]);
    }
  });

  it('handles pathological repeated-character input quickly (no exponential blowup)', () => {
    const start = Date.now();
    chunkText('a'.repeat(100_000));
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('handles text with no sentence terminators at all', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 2000 }).filter((s) => !/[.!?。！？\n\r]/.test(s)),
        (text) => {
          expect(() => chunkText(text)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('splitForDiscord fuzzing', () => {
  it('never hangs for arbitrary text with the default limit', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20000 }), (text) => {
        const result = splitForDiscord(text);
        expect(Array.isArray(result)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('never hangs for arbitrary (possibly degenerate) limit values', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 2000 }),
        fc.oneof(
          fc.integer({ min: -100, max: 5000 }),
          fc.constant(0),
          fc.constant(NaN),
          fc.constant(Infinity),
          fc.constant(-Infinity),
        ),
        (text, limit) => {
          const result = splitForDiscord(text, limit);
          expect(Array.isArray(result)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('regression: limit=0 terminates quickly instead of hanging forever', () => {
    const start = Date.now();
    const result = splitForDiscord('some message text that needs splitting up somehow', 0);
    expect(Array.isArray(result)).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('every chunk stays within the requested limit', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 5000 }), (text) => {
        const limit = 500;
        const chunks = splitForDiscord(text, limit);
        for (const c of chunks) {
          expect(c.length).toBeLessThanOrEqual(limit);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('preserves all non-whitespace content across the split (restricted to a safe ASCII alphabet to avoid Unicode whitespace-definition mismatches between trim() and \\s)', () => {
    const safeChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?\n';
    const safeText = fc
      .array(fc.constantFrom(...safeChars.split('')), { minLength: 1, maxLength: 3000 })
      .map((chars) => chars.join(''));
    fc.assert(
      fc.property(safeText, (text) => {
        const chunks = splitForDiscord(text, 200);
        const rejoined = chunks.join('').replace(/\s+/g, '');
        const original = text.replace(/\s+/g, '');
        expect(rejoined).toBe(original);
      }),
      { numRuns: 200 },
    );
  });

  it('handles a single unbroken token (no spaces/newlines) without hanging', () => {
    const start = Date.now();
    const result = splitForDiscord('a'.repeat(50_000));
    expect(Array.isArray(result)).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('returns [""] for empty/falsy input without throwing', () => {
    for (const input of ['', null, undefined]) {
      expect(splitForDiscord(input)).toEqual(['']);
    }
  });
});

describe('parseDurationMs fuzzing', () => {
  it('never throws for arbitrary string input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 50 }), (s) => {
        expect(() => parseDurationMs(s)).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });

  it('never throws for arbitrary non-string input (numbers, objects, arrays, etc.)', () => {
    fc.assert(
      fc.property(fc.anything(), (val) => {
        expect(() => parseDurationMs(val)).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });

  it('always returns null or a finite non-negative number (never NaN/Infinity/negative)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (s) => {
        const result = parseDurationMs(s);
        expect(result === null || (Number.isFinite(result) && result >= 0)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('correctly computes known day/week/month durations', () => {
    expect(parseDurationMs('1d')).toBe(24 * 60 * 60 * 1000);
    expect(parseDurationMs('2w')).toBe(2 * 7 * 24 * 60 * 60 * 1000);
    expect(parseDurationMs('3m')).toBe(3 * 30 * 24 * 60 * 60 * 1000);
  });

  it('rejects a unit suffix with no leading digits instead of returning NaN/Infinity', () => {
    expect(parseDurationMs('d')).toBeNull();
    expect(parseDurationMs('w')).toBeNull();
  });

  it('rejects non-string input outright (regression for the .toLowerCase() crash risk)', () => {
    expect(parseDurationMs(42)).toBeNull();
    expect(parseDurationMs({})).toBeNull();
    expect(parseDurationMs(['1d'])).toBeNull();
  });
});
