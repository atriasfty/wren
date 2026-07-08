import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../db/pool.js', () => ({
  query: (...a) => mocks.query(...a),
}));

const { audit, logAudit } = await import('../tenant/store.js');

describe('logAudit delegates to audit() (single INSERT path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [] });
  });

  it('logAudit writes through the same jsonb-cast INSERT as audit()', async () => {
    await logAudit('guild-1', 'user-1', 'mcp_tool_execution', { tool: 'get_player_info', args: { username: 'bob' } });

    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toMatch(/audit_log/);
    expect(sql).toMatch(/::jsonb/);
    expect(params[0]).toBe('guild-1');
    expect(params[1]).toBe('user-1');
    expect(params[2]).toBe('mcp_tool_execution');
    // metadata must be pre-serialized, matching audit()'s own contract.
    expect(params[params.length - 1]).toBe(JSON.stringify({ tool: 'get_player_info', args: { username: 'bob' } }));
  });

  it('audit() and logAudit issue byte-identical SQL', async () => {
    await audit({ tenantId: 't', actor: 'a', action: 'act', metadata: { x: 1 } });
    const auditSql = mocks.query.mock.calls[0][0];

    mocks.query.mockClear();
    await logAudit('t', 'a', 'act', { x: 1 });
    const logAuditSql = mocks.query.mock.calls[0][0];

    expect(logAuditSql).toBe(auditSql);
  });
});
