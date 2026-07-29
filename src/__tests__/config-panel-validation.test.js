import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyFieldEdit } from '../slash/configPanel.js';

const mocks = vi.hoisted(() => ({
  updateTenant: vi.fn(),
  setTenantSecret: vi.fn(),
  invalidateTenant: vi.fn(),
  resolveTenantByGuildId: vi.fn(),
}));

vi.mock('../tenant/store.js', () => ({
  updateTenant: mocks.updateTenant,
  setTenantSecret: mocks.setTenantSecret,
}));

vi.mock('../tenant/resolve.js', () => ({
  resolveTenantByGuildId: mocks.resolveTenantByGuildId,
  invalidateTenant: mocks.invalidateTenant,
}));

vi.mock('../config.js', () => ({
  loadConfig: () => ({ tenantSecretEncKey: Buffer.alloc(32) }),
}));

describe('applyFieldEdit: secret field validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setTenantSecret.mockResolvedValue();
    mocks.updateTenant.mockResolvedValue();
  });

  it('accepts a secret value containing punctuation the general SAFE charset would have rejected', async () => {
    const value = 'sk_live_a$b^c*d[e]f{g}h<i>j|k~l`m';
    const result = await applyFieldEdit('guild-1', 'erlcServerKey', value);
    expect(result.ok).toBe(true);
    expect(mocks.setTenantSecret).toHaveBeenCalledWith('guild-1', 'erlc_server_key', value, expect.any(Buffer));
  });

  it('still rejects a secret value containing control characters (e.g. embedded CR/LF)', async () => {
    const result = await applyFieldEdit('guild-1', 'powToken', 'token\r\nX-Injected: true');
    expect(result.ok).toBe(false);
    expect(mocks.setTenantSecret).not.toHaveBeenCalled();
  });

  it('treats an empty secret submission as a deliberate clear', async () => {
    const result = await applyFieldEdit('guild-1', 'erlcServerKey', '   ');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Cleared');
    expect(mocks.setTenantSecret).toHaveBeenCalledWith('guild-1', 'erlc_server_key', null, expect.any(Buffer));
  });

  it('free-text fields accept mentions, markdown, emoji, and non-Latin scripts', async () => {
    for (const value of ['ping <@123456789012345678> in emergencies', '**LA County** RP 🚓', 'ロールプレイサーバー']) {
      const result = await applyFieldEdit('guild-1', 'displayName', value);
      expect(result.ok).toBe(true);
      expect(mocks.updateTenant).toHaveBeenCalledWith('guild-1', { display_name: value }, expect.any(Buffer));
    }
  });

  it('free-text fields reject control characters with an error naming the character', async () => {
    const result = await applyFieldEdit('guild-1', 'displayName', 'bad\u0000name');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('control character');
    expect(mocks.updateTenant).not.toHaveBeenCalled();
  });

  it('single-line text fields reject line breaks but longtext allows them', async () => {
    const short = await applyFieldEdit('guild-1', 'displayName', 'two\nlines');
    expect(short.ok).toBe(false);
    expect(short.error).toContain('line break');

    const long = await applyFieldEdit('guild-1', 'coreInfo', 'line one\nline two');
    expect(long.ok).toBe(true);
  });

  it('clearing a channel field writes null to its column', async () => {
    const result = await applyFieldEdit('guild-1', 'statusChannelId', null);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Cleared');
    expect(mocks.updateTenant).toHaveBeenCalledWith('guild-1', { status_channel_id: null }, expect.any(Buffer));
  });

  it('clearing a longtext field writes empty string, not null (the column is NOT NULL)', async () => {
    const result = await applyFieldEdit('guild-1', 'coreInfo', '   ');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Cleared');
    expect(mocks.updateTenant).toHaveBeenCalledWith('guild-1', { core_info: '' }, expect.any(Buffer));
  });

  it('clearing response style writes empty string, not null', async () => {
    const result = await applyFieldEdit('guild-1', 'responseStyle', '');
    expect(result.ok).toBe(true);
    expect(mocks.updateTenant).toHaveBeenCalledWith('guild-1', { response_style: '' }, expect.any(Buffer));
  });

  it('clearing a required text field (display name) also writes empty string, not null', async () => {
    const result = await applyFieldEdit('guild-1', 'displayName', null);
    expect(result.ok).toBe(true);
    expect(mocks.updateTenant).toHaveBeenCalledWith('guild-1', { display_name: '' }, expect.any(Buffer));
  });

  it('non-secret free-text fields still accept normal punctuation', async () => {
    const result = await applyFieldEdit('guild-1', 'displayName', "LA County Roleplay - Est. 2024");
    expect(result.ok).toBe(true);
    expect(mocks.updateTenant).toHaveBeenCalledWith('guild-1', { display_name: 'LA County Roleplay - Est. 2024' }, expect.any(Buffer));
  });
});
