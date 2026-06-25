import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClient } from '../discord/client.js';
import { loadConfig } from '../config.js';
import { Client } from 'discord.js';

vi.mock('../config.js', () => ({
  loadConfig: vi.fn()
}));

// Mock the console.error and console.log to avoid test output noise
const originalConsoleError = console.error;
const originalConsoleLog = console.log;

vi.mock('discord.js', () => {
  const ClientMock = vi.fn().mockImplementation(() => {
    const handlers = {};
    return {
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
      }),
      once: vi.fn((event, handler) => {
        if (event === 'ready') {
          // Immediately invoke the ready handler for testing purposes
          setTimeout(handler, 0);
        }
      }),
      login: vi.fn().mockResolvedValue('token'),
      user: { tag: 'TestBot#1234', id: 'bot123' },
      
      // Helper to manually trigger events in tests
      emitTestEvent: (event, ...args) => {
        if (handlers[event]) handlers[event](...args);
      }
    };
  });
  
  return {
    Client: ClientMock,
    GatewayIntentBits: {
      Guilds: 1,
      GuildMembers: 2,
      GuildMessages: 4,
      MessageContent: 8,
      DirectMessages: 16
    },
    Partials: {
      Channel: 1,
      Message: 2
    }
  };
});

describe('client.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    console.error = vi.fn();
    console.log = vi.fn();
    loadConfig.mockReturnValue({ discordToken: 'test-discord-token' });
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
  });

  it('creates and returns a logged-in client', async () => {
    const client = await createClient();
    
    expect(loadConfig).toHaveBeenCalled();
    expect(Client).toHaveBeenCalled();
    expect(client.login).toHaveBeenCalledWith('test-discord-token');
    expect(client.once).toHaveBeenCalledWith('ready', expect.any(Function));
    expect(console.log).toHaveBeenCalledWith('[discord] logged in as TestBot#1234 (bot123)');
  });

  it('sets up error handlers that log to console', async () => {
    const client = await createClient();
    
    // Simulate error event
    client.emitTestEvent('error', new Error('test error'));
    expect(console.error).toHaveBeenCalledWith('[discord] client error:', 'test error');

    // Simulate shardError event
    client.emitTestEvent('shardError', new Error('shard test error'));
    expect(console.error).toHaveBeenCalledWith('[discord] shard error:', 'shard test error');
  });
});
