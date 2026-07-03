import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({
  loadConfig: () => ({ openRouterModel: 'test-model' }),
}));

import { buildSystemPrompt } from '../ai/prompts.js';

function baseCtx(overrides = {}) {
  return {
    tenantId: 'guild-1',
    tenant: {
      botDisplayName: 'Wren',
      displayName: 'Test Server',
      coreInfo: '',
      responseStyle: '',
      ...overrides.tenant,
    },
    sources: overrides.sources ?? [],
    memory: overrides.memory ?? [],
    policy: {},
    roleSlots: {},
  };
}

describe('buildSystemPrompt', () => {
  it('includes the bot and server display names', () => {
    const sys = buildSystemPrompt(baseCtx({ tenant: { botDisplayName: 'Robo', displayName: 'LA County RP' } }));
    expect(sys).toContain('You are Robo');
    expect(sys).toContain('LA County RP');
  });

  it('identifies a Discord user with nickname and id', () => {
    const actor = { kind: 'discord', member: { id: '42', nickname: 'Chief', user: { username: 'chief_actual' } } };
    const sys = buildSystemPrompt(baseCtx(), { actor });
    expect(sys).toContain('Chief (chief_actual)');
    expect(sys).toContain('"42"');
  });

  it('identifies an in-game player by username', () => {
    const actor = { kind: 'in_game', playerName: 'Roblox_Cop' };
    const sys = buildSystemPrompt(baseCtx(), { actor });
    expect(sys).toContain('Roblox_Cop');
    expect(sys).toContain('Roblox player');
  });

  it('includes server-scoped memories for everyone', () => {
    const memory = [{ scope: 'server', content: 'No corruption RP', user_key: null }];
    const sys = buildSystemPrompt(baseCtx({ memory }));
    expect(sys).toContain('No corruption RP');
  });

  it("includes the current user's own memories", () => {
    const memory = [{ scope: 'user', user_key: 'discord:42', content: 'Prefers metric units' }];
    const sys = buildSystemPrompt(baseCtx({ memory }), { actorKey: 'discord:42' });
    expect(sys).toContain('Prefers metric units');
  });

  it("NEVER includes other users' private memories in the prompt", () => {
    const memory = [
      { scope: 'user', user_key: 'discord:42', content: 'my-own-fact' },
      { scope: 'user', user_key: 'discord:99', content: 'someone-elses-private-fact' },
    ];
    const sys = buildSystemPrompt(baseCtx({ memory }), { actorKey: 'discord:42' });
    expect(sys).toContain('my-own-fact');
    expect(sys).not.toContain('someone-elses-private-fact');
  });

  it('includes no user memories at all when the actor is unknown', () => {
    const memory = [{ scope: 'user', user_key: 'discord:42', content: 'private-fact' }];
    const sys = buildSystemPrompt(baseCtx({ memory }), { actorKey: null });
    expect(sys).not.toContain('private-fact');
  });

  it('includes the admin-configured response style when set', () => {
    const sys = buildSystemPrompt(baseCtx({ tenant: { responseStyle: 'Talk like a pirate' } }));
    expect(sys).toContain('Talk like a pirate');
  });

  it('omits the response-style block when unset', () => {
    const sys = buildSystemPrompt(baseCtx());
    expect(sys).not.toContain('RESPONSE STYLE');
  });

  it('adds the voice-mode block only in voice mode', () => {
    const voice = buildSystemPrompt(baseCtx(), { mode: 'voice' });
    const text = buildSystemPrompt(baseCtx(), { mode: 'discord' });
    expect(voice).toContain('VOICE MODE ACTIVE');
    expect(text).not.toContain('VOICE MODE ACTIVE');
  });

  it('embeds the current channel id for channel-targeted actions', () => {
    const sys = buildSystemPrompt(baseCtx(), { channelId: '555666777' });
    expect(sys).toContain('555666777');
  });

  it('summarises configured sources by kind', () => {
    const sources = [
      { kind: 'discord_channel', ref: '123', label: 'rules-chat' },
      { kind: 'website', ref: 'https://docs.example.com', label: null },
    ];
    const sys = buildSystemPrompt(baseCtx({ sources }));
    expect(sys).toContain('rules-chat');
    expect(sys).toContain('https://docs.example.com');
  });
});
