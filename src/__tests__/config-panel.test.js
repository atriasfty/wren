import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildFieldModal } from '../slash/configPanel.js';

const mocks = vi.hoisted(() => ({
  applyFieldEdit: vi.fn(),
  buildCategoryPanel: vi.fn(),
  buildMainPanel: vi.fn(),
  buildValueSelectPanel: vi.fn(),
}));

vi.mock('../slash/configPanel.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    applyFieldEdit: mocks.applyFieldEdit,
    buildCategoryPanel: mocks.buildCategoryPanel,
    buildMainPanel: mocks.buildMainPanel,
    buildValueSelectPanel: mocks.buildValueSelectPanel,
    buildFieldModal: vi.fn(actual.buildFieldModal),
  };
});

vi.mock('../config.js', () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock('../tenant/resolve.js', () => ({
  resolveTenantByGuildId: vi.fn(() => Promise.resolve({ tenant: {} })),
  invalidateTenant: vi.fn(),
}));

vi.mock('../ai/policy.js', () => ({
  resolveActorRank: vi.fn(() => 'leadership'),
  RANK_ORDER: { owner: 4, leadership: 3, admin: 2, mod: 1, user: 0 },
}));

describe('config panel components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyFieldEdit.mockResolvedValue({ ok: true, message: 'Saved.' });
    mocks.buildCategoryPanel.mockResolvedValue({ embeds: ['category'], components: ['rows'] });
    mocks.buildMainPanel.mockResolvedValue({ embeds: ['main'], components: ['rows'] });
    mocks.buildValueSelectPanel.mockResolvedValue({ embeds: ['picker'], components: ['rows'] });
  });

  it('does not build invalid channel or role modals', async () => {
    await expect(buildFieldModal('123456789012345678', 'statusChannelId')).resolves.toBeNull();
    await expect(buildFieldModal('123456789012345678', 'leadershipRoleId')).resolves.toBeNull();
  });

  it('keeps valid text fields as text-input modals', async () => {
    const modal = await buildFieldModal('123456789012345678', 'displayName');
    const json = modal.toJSON();

    expect(json.custom_id).toBe('wren_cfg_modal:123456789012345678:displayName');
    expect(json.components[0].components[0].type).toBe(4);
  });

  it('parses modal custom IDs as tenant id plus field key', async () => {
    const { handleComponentInteraction } = await import('../slash/handlers.js');
    const interaction = {
      customId: 'wren_cfg_modal:123456789012345678:displayName',
      guild: { id: '123456789012345678' },
      member: { permissions: { has: () => true } },
      components: [{ components: [{ customId: 'value', value: 'New name' }] }],
      update: vi.fn(),
      reply: vi.fn(),
    };

    await handleComponentInteraction(interaction);

    expect(mocks.applyFieldEdit).toHaveBeenCalledWith('123456789012345678', 'displayName', 'New name');
    expect(mocks.buildCategoryPanel).toHaveBeenCalledWith('123456789012345678', 'Identity');
    expect(interaction.update).toHaveBeenCalledWith({
      content: 'Saved.',
      embeds: ['category'],
      components: ['rows'],
      ephemeral: true,
    });
  });

  it('rejects a component whose embedded tenant id is not the interaction guild', async () => {
    const { handleComponentInteraction } = await import('../slash/handlers.js');
    const interaction = {
      customId: 'wren_cfg_modal:999999999999999999:erlcServerKey',
      guild: { id: '123456789012345678' }, // different from the customId tenant id
      member: { permissions: { has: () => true } },
      components: [{ components: [{ customId: 'value', value: 'super-secret-key' }] }],
      update: vi.fn(),
      reply: vi.fn(),
    };

    await handleComponentInteraction(interaction);

    expect(mocks.applyFieldEdit).not.toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('routes channel and role fields to message-level picker panels', async () => {
    const { handleComponentInteraction } = await import('../slash/handlers.js');
    const interaction = {
      customId: 'wren_cfg_field:123456789012345678',
      guild: { id: '123456789012345678' },
      values: ['statusChannelId'],
      member: { permissions: { has: () => true } },
      showModal: vi.fn(),
      update: vi.fn(),
      reply: vi.fn(),
    };

    await handleComponentInteraction(interaction);

    expect(mocks.buildValueSelectPanel).toHaveBeenCalledWith('123456789012345678', 'statusChannelId');
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.update).toHaveBeenCalledWith({
      content: '',
      embeds: ['picker'],
      components: ['rows'],
      ephemeral: true,
    });
  });
});
