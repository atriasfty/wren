import { describe, it, expect } from 'vitest';
import { TOOL_DEFS, TOOL_NAMES, DISCORD_ONLY_TOOLS, getToolsForMistral, policyToolKey } from '../ai/tools.js';
import { POLICY_GATED_TOOLS } from '../ai/policy.js';
import { getDefaultPolicy } from '../tenant/store.js';

describe('policyToolKey', () => {
  it('maps save_memory type=server to save_memory_server', () => {
    expect(policyToolKey('save_memory', { type: 'server' })).toBe('save_memory_server');
  });

  it('maps save_memory type=user to save_memory_user', () => {
    expect(policyToolKey('save_memory', { type: 'user' })).toBe('save_memory_user');
  });

  it('maps delete_memory type=server to delete_memory_server', () => {
    expect(policyToolKey('delete_memory', { type: 'server' })).toBe('delete_memory_server');
  });

  it('maps delete_memory type=user to delete_memory_user', () => {
    expect(policyToolKey('delete_memory', { type: 'user' })).toBe('delete_memory_user');
  });

  it('treats save_memory with missing type as the user flavour (least privileged)', () => {
    expect(policyToolKey('save_memory', {})).toBe('save_memory_user');
    expect(policyToolKey('delete_memory', undefined)).toBe('delete_memory_user');
  });

  it('passes all other tool names through unchanged', () => {
    expect(policyToolKey('ban_player', { username: 'x' })).toBe('ban_player');
    expect(policyToolKey('search_web', {})).toBe('search_web');
  });
});

describe('tool definitions', () => {
  it('every tool def has a name, description, and object params schema', () => {
    for (const t of TOOL_DEFS) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.params?.type).toBe('object');
    }
  });

  it('tool names are unique', () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
  });

  it('every DISCORD_ONLY tool is a real tool', () => {
    for (const name of DISCORD_ONLY_TOOLS) {
      expect(TOOL_NAMES).toContain(name);
    }
  });

  it('DEFAULT_POLICY and POLICY_GATED_TOOLS stay in sync (no ungated policy keys, no phantom gates)', () => {
    const policyKeys = new Set(Object.keys(getDefaultPolicy()));
    for (const key of policyKeys) {
      expect(POLICY_GATED_TOOLS.has(key), `DEFAULT_POLICY key "${key}" missing from POLICY_GATED_TOOLS`).toBe(true);
    }
    for (const key of POLICY_GATED_TOOLS) {
      expect(policyKeys.has(key), `POLICY_GATED_TOOLS key "${key}" missing from DEFAULT_POLICY`).toBe(true);
    }
  });

  it('every policy-relevant tool resolves to a gated policy key', () => {
    // Tools whose policy key differs from their name
    expect(POLICY_GATED_TOOLS.has(policyToolKey('save_memory', { type: 'server' }))).toBe(true);
    expect(POLICY_GATED_TOOLS.has(policyToolKey('delete_memory', { type: 'server' }))).toBe(true);
    expect(POLICY_GATED_TOOLS.has(policyToolKey('delete_memory', { type: 'user' }))).toBe(true);
  });
});

describe('getToolsForMistral', () => {
  it('excludes Discord-only tools for non-Discord actors', () => {
    const tools = getToolsForMistral({ isDiscordActor: false });
    const names = tools.map((t) => t.function.name);
    for (const blocked of DISCORD_ONLY_TOOLS) {
      expect(names).not.toContain(blocked);
    }
  });

  it('includes Discord-only tools for Discord actors', () => {
    const tools = getToolsForMistral({ isDiscordActor: true });
    const names = tools.map((t) => t.function.name);
    expect(names).toContain('get_channel_messages');
    expect(names).toContain('purge_messages');
  });

  it('defaults to the Discord tool set', () => {
    expect(getToolsForMistral().length).toBe(TOOL_DEFS.length);
  });

  it('emits OpenAI-compatible function-tool wrappers', () => {
    const tools = getToolsForMistral();
    for (const t of tools) {
      expect(t.type).toBe('function');
      expect(t.function.parameters?.type).toBe('object');
    }
  });
});
