import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyFieldEdit: vi.fn(),
  buildCategoryPanel: vi.fn(),
  reviewPersonalityText: vi.fn(),
  incrementMessageUsage: vi.fn(),
  decrementMessageUsage: vi.fn(),
  countRecentPersonalityReviews: vi.fn(),
  audit: vi.fn(),
  query: vi.fn(),
}));

vi.mock('../slash/configPanel.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    applyFieldEdit: mocks.applyFieldEdit,
    buildCategoryPanel: mocks.buildCategoryPanel,
  };
});

vi.mock('../config.js', () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock('../tenant/resolve.js', () => ({
  resolveTenantByGuildId: vi.fn(() => Promise.resolve({ tenant: { subscriptionTier: 'free', displayName: 'Test server' } })),
  invalidateTenant: vi.fn(),
}));

vi.mock('../ai/policy.js', () => ({
  resolveActorRank: vi.fn(() => 'leadership'),
  RANK_ORDER: { owner: 4, leadership: 3, admin: 2, mod: 1, user: 0 },
}));

vi.mock('../ai/personalityReview.js', () => ({
  reviewPersonalityText: mocks.reviewPersonalityText,
}));

vi.mock('../db/pool.js', () => ({
  query: mocks.query,
}));

vi.mock('../tenant/store.js', () => ({
  createTenant: vi.fn(),
  listSources: vi.fn(),
  addSource: vi.fn(),
  removeSource: vi.fn(),
  setSourceEnabled: vi.fn(),
  listBans: vi.fn(),
  addBan: vi.fn(),
  removeBan: vi.fn(),
  listMemory: vi.fn(),
  removeMemory: vi.fn(),
  incrementMessageUsage: mocks.incrementMessageUsage,
  decrementMessageUsage: mocks.decrementMessageUsage,
  countRecentPersonalityReviews: mocks.countRecentPersonalityReviews,
  audit: mocks.audit,
}));

const TENANT_ID = '123456789012345678';

function makePublicMessage() {
  return { edit: vi.fn().mockResolvedValue(undefined) };
}

function makeModalInteraction(fieldKey, value, publicMessage) {
  return {
    customId: `wren_cfg_modal:${TENANT_ID}:${fieldKey}`,
    guild: { id: TENANT_ID },
    member: { permissions: { has: () => true } },
    user: { id: 'submitter-1' },
    components: [{ components: [{ customId: 'value', value }] }],
    channel: { send: vi.fn().mockResolvedValue(publicMessage) },
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn(),
    reply: vi.fn(),
  };
}

function extractButtonCustomId(publicMessage, label) {
  const call = publicMessage.edit.mock.calls.find((c) => c[0]?.components?.length);
  const row = call[0].components[0];
  const json = row.toJSON();
  return json.components.find((c) => c.label === label).custom_id;
}

describe('personality change moderation review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyFieldEdit.mockResolvedValue({ ok: true, message: 'Saved.' });
    mocks.buildCategoryPanel.mockResolvedValue({ embeds: ['behaviour'], components: ['rows'] });
    mocks.countRecentPersonalityReviews.mockResolvedValue(0);
    mocks.incrementMessageUsage.mockResolvedValue(1);
    mocks.query.mockResolvedValue({ rowCount: 0, rows: [] }); // no bypass grant pending, by default
  });

  it('skips review entirely when the submission clears the field', async () => {
    const { handleComponentInteraction } = await import('../slash/handlers.js');
    const publicMessage = makePublicMessage();
    const interaction = makeModalInteraction('responseStyle', '   ', publicMessage);

    await handleComponentInteraction(interaction);

    expect(mocks.reviewPersonalityText).not.toHaveBeenCalled();
    expect(interaction.channel.send).not.toHaveBeenCalled();
    expect(mocks.applyFieldEdit).toHaveBeenCalledWith(TENANT_ID, 'responseStyle', '   ');
  });

  it('saves and posts an approval when the reviewer approves', async () => {
    mocks.reviewPersonalityText.mockResolvedValue({ approved: true, reason: 'fine', errored: false });
    const { handleComponentInteraction } = await import('../slash/handlers.js');
    const publicMessage = makePublicMessage();
    const interaction = makeModalInteraction('responseStyle', 'Be a sarcastic pirate.', publicMessage);

    await handleComponentInteraction(interaction);

    expect(mocks.reviewPersonalityText).toHaveBeenCalledWith({ fieldLabel: 'Response style', value: 'Be a sarcastic pirate.' });
    expect(mocks.applyFieldEdit).toHaveBeenCalledWith(TENANT_ID, 'responseStyle', 'Be a sarcastic pirate.');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID, action: 'personality_review', target: 'responseStyle',
      metadata: expect.objectContaining({ approved: true }),
    }));
    expect(publicMessage.edit).toHaveBeenCalledWith({ content: expect.stringContaining('✅') });
    expect(mocks.incrementMessageUsage).not.toHaveBeenCalled();
  });

  it('blocks the save and posts a denial when the reviewer denies', async () => {
    mocks.reviewPersonalityText.mockResolvedValue({ approved: false, reason: 'Impersonates a real person.', errored: false });
    const { handleComponentInteraction } = await import('../slash/handlers.js');
    const publicMessage = makePublicMessage();
    const interaction = makeModalInteraction('responseStyle', 'Talk like a famous politician.', publicMessage);

    await handleComponentInteraction(interaction);

    expect(mocks.applyFieldEdit).not.toHaveBeenCalled();
    expect(publicMessage.edit).toHaveBeenCalledWith({ content: expect.stringContaining('❌') });
    expect(publicMessage.edit.mock.calls[0][0].content).toContain('Impersonates a real person.');
  });

  it('skips the reviewer and applies the edit when a staff $atria personality bypass is pending', async () => {
    mocks.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ value: { expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), grantedBy: 'staff-1' } }],
    });
    const { handleComponentInteraction } = await import('../slash/handlers.js');
    const publicMessage = makePublicMessage();
    const interaction = makeModalInteraction('responseStyle', 'Talk like a famous politician.', publicMessage);

    await handleComponentInteraction(interaction);

    expect(mocks.query).toHaveBeenCalledWith(
      'DELETE FROM global_state WHERE key = $1 RETURNING value',
      ['personality_bypass:123456789012345678'],
    );
    expect(mocks.reviewPersonalityText).not.toHaveBeenCalled();
    expect(mocks.applyFieldEdit).toHaveBeenCalledWith(TENANT_ID, 'responseStyle', 'Talk like a famous politician.');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      action: 'personality_review_bypassed',
      target: 'responseStyle',
      metadata: expect.objectContaining({ grantedBy: 'staff-1' }),
    }));
    expect(publicMessage.edit).toHaveBeenCalledWith({ content: expect.stringContaining('bypassed') });
  });

  it('ignores an expired bypass grant and runs the reviewer normally', async () => {
    mocks.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ value: { expiresAt: new Date(Date.now() - 1000).toISOString(), grantedBy: 'staff-1' } }],
    });
    mocks.reviewPersonalityText.mockResolvedValue({ approved: true, reason: 'fine', errored: false });
    const { handleComponentInteraction } = await import('../slash/handlers.js');
    const publicMessage = makePublicMessage();
    const interaction = makeModalInteraction('responseStyle', 'Be a sarcastic pirate.', publicMessage);

    await handleComponentInteraction(interaction);

    expect(mocks.reviewPersonalityText).toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'personality_review' }));
  });

  it('gates the 4th change in 12h behind a leadership approve/deny before spending quota', async () => {
    mocks.countRecentPersonalityReviews.mockResolvedValue(3);
    const { handleComponentInteraction } = await import('../slash/handlers.js');
    const publicMessage = makePublicMessage();
    const modalInteraction = makeModalInteraction('coreInfo', 'This is our server vibe.', publicMessage);

    await handleComponentInteraction(modalInteraction);

    expect(mocks.reviewPersonalityText).not.toHaveBeenCalled();
    expect(mocks.applyFieldEdit).not.toHaveBeenCalled();
    const approveId = extractButtonCustomId(publicMessage, 'Approve');
    expect(approveId).toMatch(new RegExp(`^wren_cfg_modreview:${TENANT_ID}:`));

    mocks.reviewPersonalityText.mockResolvedValue({ approved: true, reason: 'fine', errored: false });
    const approveInteraction = {
      customId: approveId,
      guild: { id: TENANT_ID },
      member: { permissions: { has: () => true } },
      user: { id: 'approver-1' },
      update: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
    };

    await handleComponentInteraction(approveInteraction);

    expect(mocks.incrementMessageUsage).toHaveBeenCalledWith(TENANT_ID, 10);
    expect(mocks.reviewPersonalityText).toHaveBeenCalledWith({ fieldLabel: 'Core info (always-on note)', value: 'This is our server vibe.' });
    expect(mocks.applyFieldEdit).toHaveBeenCalledWith(TENANT_ID, 'coreInfo', 'This is our server vibe.');
    expect(approveInteraction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('✅') });
  });

  it('cancels the change without spending quota when a leadership member denies the quota gate', async () => {
    mocks.countRecentPersonalityReviews.mockResolvedValue(5);
    const { handleComponentInteraction } = await import('../slash/handlers.js');
    const publicMessage = makePublicMessage();
    const modalInteraction = makeModalInteraction('responseStyle', 'Something to review.', publicMessage);

    await handleComponentInteraction(modalInteraction);
    const denyId = extractButtonCustomId(publicMessage, 'Deny');

    const denyInteraction = {
      customId: denyId,
      guild: { id: TENANT_ID },
      member: { permissions: { has: () => true } },
      user: { id: 'approver-2' },
      update: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
    };

    await handleComponentInteraction(denyInteraction);

    expect(mocks.incrementMessageUsage).not.toHaveBeenCalled();
    expect(mocks.reviewPersonalityText).not.toHaveBeenCalled();
    expect(mocks.applyFieldEdit).not.toHaveBeenCalled();
    expect(denyInteraction.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('cancelled'),
    }));
  });
});
