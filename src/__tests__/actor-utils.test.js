import { describe, it, expect } from 'vitest';
import { actorKey } from '../ai/utils.js';

describe('actorKey', () => {
  it('formats Discord actors from the member id', () => {
    expect(actorKey({ kind: 'discord', member: { id: '123' } })).toBe('discord:123');
  });

  it('falls back to a placeholder when a Discord actor has no member', () => {
    expect(actorKey({ kind: 'discord' })).toBe('discord:?');
  });

  it('formats in-game actors from the player name', () => {
    expect(actorKey({ kind: 'in_game', playerName: 'Roblox_Cop' })).toBe('ingame:Roblox_Cop');
  });

  it('formats API actors from the token id', () => {
    expect(actorKey({ kind: 'api', tokenId: 'abcd1234' })).toBe('api:abcd1234');
  });

  it('returns unknown for a missing actor', () => {
    expect(actorKey(null)).toBe('unknown');
    expect(actorKey(undefined)).toBe('unknown');
  });

  it('returns unknown for unrecognised actor kinds (never leaks raw objects)', () => {
    expect(actorKey({ kind: 'system' })).toBe('unknown');
    expect(actorKey({ kind: 'weird', secret: 'x' })).toBe('unknown');
  });
});
