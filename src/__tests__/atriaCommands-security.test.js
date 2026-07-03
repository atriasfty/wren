import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAtriaCommands } from '../discord/atriaCommands.js';
import { query } from '../db/pool.js';
import { resolveTenantByGuildId } from '../tenant/resolve.js';
import { issueApiToken } from '../tenant/store.js';

vi.mock('../db/pool.js', () => ({ query: vi.fn() }));
vi.mock('../tenant/resolve.js', () => ({ resolveTenantByGuildId: vi.fn() }));
vi.mock('../tenant/store.js', () => ({ issueApiToken: vi.fn() }));
vi.mock('../tenant/crypto.js', () => ({
  generateApiToken: vi.fn(() => 'wren_GENERATED_TOKEN'),
  hashToken: vi.fn(() => 'hashed_token_value'),
}));
vi.mock('discord.js', () => ({
  EmbedBuilder: vi.fn().mockImplementation(() => ({
    setTitle: vi.fn().mockReturnThis(),
    setColor: vi.fn().mockReturnThis(),
    addFields: vi.fn().mockReturnThis(),
  })),
}));

const STAFF_ID = '111111111111111111';
process.env.ATRIA_STAFF_IDS = `${STAFF_ID}, 222222222222222222`;

function makeMessage(content, authorId = STAFF_ID) {
  return {
    author: { id: authorId, send: vi.fn().mockResolvedValue(true) },
    content,
    reply: vi.fn().mockResolvedValue(true),
    guild: { id: 'guild-1' },
    client: { guilds: { cache: { get: vi.fn() } }, channels: { fetch: vi.fn() } },
  };
}

describe('$atria access control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('silently ignores non-staff users, even for read commands', async () => {
    const msg = makeMessage('$atria serverinfo', '999999999999999999');
    const handled = await handleAtriaCommands(msg);
    expect(handled).toBe(false);
    expect(msg.reply).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('non-staff cannot confirm a staff member’s pending command', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    const staffMsg = makeMessage('$atria globalban 123456789012345678');
    await handleAtriaCommands(staffMsg);

    const intruder = makeMessage('$atria confirm', '999999999999999999');
    const handled = await handleAtriaCommands(intruder);
    expect(handled).toBe(false);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO global_bans'), expect.anything());
  });

  it('accepts trimmed comma-separated staff ids from env', async () => {
    const msg = makeMessage('$atria unknowncmd', '222222222222222222');
    const handled = await handleAtriaCommands(msg);
    expect(handled).toBe(true);
    expect(msg.reply).toHaveBeenCalledWith('Unknown $atria command.');
  });

  it('ignores messages that do not start with $atria', async () => {
    const handled = await handleAtriaCommands(makeMessage('hello $atria'));
    expect(handled).toBe(false);
  });
});

describe('$atria confirmation TTL', () => {
  let nowSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    nowSpy = vi.spyOn(Date, 'now');
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('executes when confirmed within 60 seconds', async () => {
    nowSpy.mockReturnValue(1_000_000);
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const msg = makeMessage('$atria globalban 123456789012345678');
    await handleAtriaCommands(msg);

    nowSpy.mockReturnValue(1_000_000 + 59_000);
    msg.content = '$atria confirm';
    await handleAtriaCommands(msg);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO global_bans'), expect.anything());
  });

  it('refuses to execute a stale confirmation (destructive commands cannot linger)', async () => {
    nowSpy.mockReturnValue(1_000_000);
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const msg = makeMessage('$atria wipe server guild-1');
    await handleAtriaCommands(msg);

    nowSpy.mockReturnValue(1_000_000 + 61_000);
    msg.content = '$atria confirm';
    await handleAtriaCommands(msg);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM tenants'), expect.anything());
    expect(msg.reply).toHaveBeenLastCalledWith(expect.stringContaining('expired'));
  });

  it('a stale confirmation also clears the pending command (no second chance)', async () => {
    nowSpy.mockReturnValue(1_000_000);
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const msg = makeMessage('$atria wipe server guild-1');
    await handleAtriaCommands(msg);

    nowSpy.mockReturnValue(1_000_000 + 61_000);
    msg.content = '$atria confirm';
    await handleAtriaCommands(msg);

    msg.content = '$atria confirm';
    await handleAtriaCommands(msg);
    expect(msg.reply).toHaveBeenLastCalledWith('No pending command to confirm.');
  });
});

describe('$atria apitoken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantByGuildId.mockResolvedValue({ tenantId: 'guild-1', tenant: { displayName: 'Test' } });
  });

  async function runAndConfirm(msg) {
    await handleAtriaCommands(msg);
    msg.content = '$atria confirm';
    await handleAtriaCommands(msg);
  }

  it('delivers the raw token only via DM — never into the channel', async () => {
    const msg = makeMessage('$atria apitoken guild-1 ci-bot');
    await runAndConfirm(msg);

    expect(issueApiToken).toHaveBeenCalledWith({
      tenantId: 'guild-1',
      tokenHash: 'hashed_token_value',
      label: 'ci-bot',
      scopes: ['chat'],
    });
    expect(msg.author.send).toHaveBeenCalledWith(expect.stringContaining('wren_GENERATED_TOKEN'));
    for (const call of msg.reply.mock.calls) {
      expect(String(call[0])).not.toContain('wren_GENERATED_TOKEN');
    }
  });

  it('stores only the hash, never the raw token', async () => {
    const msg = makeMessage('$atria apitoken guild-1');
    await runAndConfirm(msg);
    const stored = issueApiToken.mock.calls[0][0];
    expect(stored.tokenHash).toBe('hashed_token_value');
    expect(JSON.stringify(stored)).not.toContain('wren_GENERATED_TOKEN');
  });

  it('does nothing for servers not configured with Wren', async () => {
    resolveTenantByGuildId.mockResolvedValue(null);
    const msg = makeMessage('$atria apitoken guild-unknown');
    await runAndConfirm(msg);
    expect(issueApiToken).not.toHaveBeenCalled();
  });

  it('still confirms token creation when the DM fails, without leaking it to the channel', async () => {
    const msg = makeMessage('$atria apitoken guild-1');
    msg.author.send = vi.fn().mockRejectedValue(new Error('DMs closed'));
    await runAndConfirm(msg);
    expect(issueApiToken).toHaveBeenCalled();
    expect(msg.reply).toHaveBeenLastCalledWith(expect.stringContaining('could not DM'));
    for (const call of msg.reply.mock.calls) {
      expect(String(call[0])).not.toContain('wren_GENERATED_TOKEN');
    }
  });
});

describe('$atria wipe user (data deletion)', () => {
  it('removes consent, memories, MCP tokens, audit entries, and bypass state', async () => {
    vi.clearAllMocks();
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const msg = makeMessage('$atria wipe user 424242424242424242');
    await handleAtriaCommands(msg);
    msg.content = '$atria confirm';
    await handleAtriaCommands(msg);

    const sql = query.mock.calls.map((c) => c[0]).join('\n');
    expect(sql).toContain('DELETE FROM user_agreements');
    expect(sql).toContain('DELETE FROM tenant_memory');
    expect(sql).toContain('DELETE FROM user_mcp_tokens');
    expect(sql).toContain('DELETE FROM audit_log');
    expect(sql).toContain('DELETE FROM global_state');
    // memory deletion must be keyed to the discord-prefixed user key
    expect(query).toHaveBeenCalledWith('DELETE FROM tenant_memory WHERE user_key = $1', ['discord:424242424242424242']);
  });
});
