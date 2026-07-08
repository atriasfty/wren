import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../db/pool.js', () => ({
  query: (...a) => mocks.query(...a),
}));

const { incrementMessageUsage } = await import('../tenant/store.js');

describe('incrementMessageUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the tier limit through so the counter can stop growing once already over it', async () => {
    mocks.query.mockResolvedValue({ rows: [{ monthly_message_count: 11 }] });
    const used = await incrementMessageUsage('guild-1', 10);

    expect(used).toBe(11);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(params).toEqual(['guild-1', 10]);
    // The cap clause must reference the limit param, or a blocked user's
    // counter grows unboundedly forever instead of freezing once over.
    expect(sql).toMatch(/monthly_message_count\s*>\s*\$2/);
  });

  it('returns 0 when the tenant row is missing', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const used = await incrementMessageUsage('missing-guild', 10);
    expect(used).toBe(0);
  });
});
