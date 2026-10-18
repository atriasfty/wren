import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyFieldEdit: vi.fn(),
  buildCategoryPanel: vi.fn(),
  reviewPersonalityText: vi.fn(),
  incrementMessageUsage: vi.fn(),
  decrementMessageUsage: vi.fn(),
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

// Components V2 payloads nest text and buttons inside containers; serialise
// (builders implement toJSON) and search the result.
function payloadText(payload) {
  return JSON.stringify(payload);
}

function lastCallText(spy) {
  return payloadText(spy.mock.calls.at(-1)?.[0]);
}

function extractButtonCustomId(publicMessage, label) {
  for (const [payload] of publicMessage.edit.mock.calls) {
    const json = JSON.parse(payloadText(payload));
    const stack = [json];
    while (stack.length) {
      const node = stack.pop();
      if (node && typeof node === 'object') {
        if (node.label === label && node.custom_id) return node.custom_id;
        stack.push(...Object.values(node));
      }
    }
  }
  return undefined;
}

describe('personality change moderation review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyFieldEdit.mockResolvedValue({ ok: true, message: 'Saved.' });
    mocks.buildCategoryPanel.mockResolvedValue({ embeds: ['behaviour'], components: ['rows'] });
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
    expect(lastCallText(publicMessage.edit)).toContain('✅');
    expect(mocks.incrementMessageUsage).not.toHaveBeenCalled();
  });

  it('blocks the save and posts a denial when the reviewer denies', async () => {
    mocks.reviewPersonalityText.mockResolvedValue({ approved: false, reason: 'Impersonates a real person.', errored: false });
    const { handleComponentInteraction } = await import('../slash/handlers.js');
    const publicMessage = makePublicMessage();
    const interaction = makeModalInteraction('responseStyle', 'Talk like a famous politician.', publicMessage);

    await handleComponentInteraction(interaction);

    expect(mocks.applyFieldEdit).not.toHaveBeenCalled();
    expect(lastCallText(publicMessage.edit)).toContain('❌');
    expect(lastCallText(publicMessage.edit)).toContain('Impersonates a real person.');
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
    expect(lastCallText(publicMessage.edit)).toContain('bypassed');
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

  it('reviews every change for free, with no quota charge or approval gate, however many came before', async () => {
    mocks.reviewPersonalityText.mockResolvedValue({ approved: true, reason: 'fine', errored: false });
    const { handleComponentInteraction } = await import('../slash/handlers.js');
    for (let i = 0; i < 5; i++) {
      const publicMessage = makePublicMessage();
      await handleComponentInteraction(makeModalInteraction('coreInfo', `This is our server vibe ${i}.`, publicMessage));
      expect(lastCallText(publicMessage.edit)).toContain('✅');
    }
    expect(mocks.reviewPersonalityText).toHaveBeenCalledTimes(5);
    expect(mocks.applyFieldEdit).toHaveBeenCalledTimes(5);
    expect(mocks.incrementMessageUsage).not.toHaveBeenCalled();
    expect(mocks.decrementMessageUsage).not.toHaveBeenCalled();
  });

  it('answers stale approve/deny buttons from the old quota gate without reviewing', async () => {
    const { handleComponentInteraction } = await import('../slash/handlers.js');
    const stale = {
      customId: `wren_cfg_modreview:${TENANT_ID}:abc123:approve`,
      guild: { id: TENANT_ID },
      member: { permissions: { has: () => true } },
      user: { id: 'approver-1' },
      update: vi.fn(), editReply: vi.fn(), reply: vi.fn().mockResolvedValue(undefined),
    };
    await handleComponentInteraction(stale);
    expect(stale.reply).toHaveBeenCalled();
    expect(mocks.reviewPersonalityText).not.toHaveBeenCalled();
  });

  it('rejects an invalid value before review, without saving or claiming "updated"', async () => {
    mocks.reviewPersonalityText.mockResolvedValue({ approved: true, reason: 'fine', errored: false });
    const { handleComponentInteraction } = await import('../slash/handlers.js');
    const publicMessage = makePublicMessage();
    const interaction = makeModalInteraction('responseStyle', 'Be\tterse.', publicMessage);

    await handleComponentInteraction(interaction);

    expect(mocks.reviewPersonalityText).not.toHaveBeenCalled();
    expect(mocks.applyFieldEdit).not.toHaveBeenCalled();
    expect(lastCallText(publicMessage.edit)).toContain("wasn't saved");
  });

  it('does not leave the public message stuck on "reviewing" when the review throws', async () => {
    mocks.reviewPersonalityText.mockRejectedValue(new Error('reviewer down'));
    const { handleComponentInteraction } = await import('../slash/handlers.js');
    const publicMessage = makePublicMessage();
    const interaction = makeModalInteraction('responseStyle', 'Be terse.', publicMessage);

    await handleComponentInteraction(interaction);

    expect(lastCallText(publicMessage.edit)).toContain("couldn't be reviewed");
    expect(mocks.applyFieldEdit).not.toHaveBeenCalled();
  });
});
