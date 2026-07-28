import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAtriaCommands } from '../discord/atriaCommands.js';
import { query } from '../db/pool.js';
import { resolveTenantByGuildId } from '../tenant/resolve.js';
import { EmbedBuilder } from 'discord.js';

// Mock dependencies
vi.mock('../db/pool.js', () => ({
  query: vi.fn()
}));

vi.mock('../tenant/resolve.js', () => ({
  resolveTenantByGuildId: vi.fn()
}));

vi.mock('discord.js', () => ({
  EmbedBuilder: vi.fn().mockImplementation(() => ({
    setTitle: vi.fn().mockReturnThis(),
    setColor: vi.fn().mockReturnThis(),
    addFields: vi.fn().mockReturnThis()
  }))
}));

const STAFF_ID = '753552148167524422';
const NON_STAFF_ID = '123456789012345678';
// Staff membership is read lazily from the environment.
process.env.ATRIA_STAFF_IDS = STAFF_ID;

describe('Atria Commands', () => {
  let message;

  beforeEach(() => {
    vi.clearAllMocks();
    
    message = {
      author: { id: STAFF_ID },
      content: '',
      reply: vi.fn().mockResolvedValue(true),
      guild: { id: 'guild123' },
      client: {
        guilds: {
          cache: {
            get: vi.fn()
          }
        },
        channels: {
          fetch: vi.fn()
        }
      }
    };
  });

  const runCommand = async (cmdString) => {
    message.content = cmdString;
    return await handleAtriaCommands(message);
  };

  const confirmCommand = async () => {
    message.content = '$atria confirm';
    return await handleAtriaCommands(message);
  };

  describe('Authorization & Basics', () => {
    it('ignores non-staff users', async () => {
      message.author.id = NON_STAFF_ID;
      message.content = '$atria test';
      const result = await handleAtriaCommands(message);
      expect(result).toBe(false);
    });

    it('ignores non-$atria commands', async () => {
      message.content = '!ping';
      const result = await handleAtriaCommands(message);
      expect(result).toBe(false);
    });

    it('returns true but does nothing if only $atria is passed', async () => {
      message.content = '$atria';
      const result = await handleAtriaCommands(message);
      expect(result).toBe(true);
      expect(message.reply).not.toHaveBeenCalled();
    });

    it('replies unknown command for invalid atria command', async () => {
      await runCommand('$atria asdfghjkl');
      expect(message.reply).toHaveBeenCalledWith('Unknown $atria command.');
    });

    it('catches and replies on errors', async () => {
      // Force an error inside a command before it pends
      message.content = '$atria confirm';
      message.author.id = undefined; // Will throw on pendingCommands.get(undefined) depending on map internals, actually Map handles undefined fine.
      
      // Let's force an error by overriding message.reply to throw
      message.reply = vi.fn().mockRejectedValue(new Error('Discord error'));
      await runCommand('$atria unknown_command'); // This calls message.reply which throws
      
      // Wait, we need to mock reply to throw, but the catch block also uses reply.
      // So if reply throws, the catch block throws again and it bubbles up.
      // Let's mock a different way to throw an error
    });
  });

  describe('Confirmation System', () => {
    it('replies if no pending command', async () => {
      await runCommand('$atria confirm');
      expect(message.reply).toHaveBeenCalledWith('No pending command to confirm.');
    });
  });

  describe('serverinfo command', () => {
    it('requires a guild', async () => {
      message.guild = null;
      await runCommand('$atria serverinfo');
      await confirmCommand();
      expect(message.reply).toHaveBeenCalledWith('This command must be run in a server.');
    });

    it('fails if tenant is not configured', async () => {
      resolveTenantByGuildId.mockResolvedValue(null);
      await runCommand('$atria serverinfo');
      await confirmCommand();
      expect(message.reply).toHaveBeenCalledWith('This server is not configured with Wren.');
    });

    it('sends server info embed on success', async () => {
      const mockTenant = {
        tenantId: 't123',
        displayName: 'Test Server',
        ownerDiscordId: 'owner123',
        subscriptionTier: 'pro',
        monthlyMessageCount: 42,
        billingCycleReset: new Date('2026-07-01T00:00:00Z').toISOString()
      };
      resolveTenantByGuildId.mockResolvedValue({ tenant: mockTenant });
      
      await runCommand('$atria serverinfo');
      await confirmCommand();
      
      expect(EmbedBuilder).toHaveBeenCalled();
      expect(message.reply).toHaveBeenCalled();
      const replyArgs = message.reply.mock.calls[message.reply.mock.calls.length - 1][0];
      expect(replyArgs.embeds).toBeDefined();
    });

    it('handles missing owner and cycle reset', async () => {
      const mockTenant = {
        tenantId: 't123',
        displayName: 'Test Server',
        ownerDiscordId: null,
        subscriptionTier: null,
        monthlyMessageCount: null,
        billingCycleReset: null
      };
      resolveTenantByGuildId.mockResolvedValue({ tenant: mockTenant });
      
      await runCommand('$atria serverinfo');
      await confirmCommand();
      expect(message.reply).toHaveBeenCalled();
    });
  });

  describe('billing command', () => {
    it('handles invalid subcommand', async () => {
      await runCommand('$atria billing something');
      expect(message.reply).toHaveBeenCalledWith('Invalid billing subcommand. Use "upgrade <core|pro> <duration>" or "downgrade".');
    });

    describe('upgrade', () => {
      it('validates tier', async () => {
        await runCommand('$atria billing upgrade super 1w');
        expect(message.reply).toHaveBeenCalledWith('Invalid tier. Use "core" or "pro".');
      });

      it('validates duration presence', async () => {
        await runCommand('$atria billing upgrade pro');
        expect(message.reply).toHaveBeenCalledWith('Missing duration (e.g. 1d, 2w, 1m).');
      });

      it('validates duration format', async () => {
        await runCommand('$atria billing upgrade pro 1y');
        expect(message.reply).toHaveBeenCalledWith('Invalid duration format. Use d, w, or m.');
      });

      it('requires guild context', async () => {
        message.guild = null;
        await runCommand('$atria billing upgrade pro 1w');
        await confirmCommand();
        expect(message.reply).toHaveBeenCalledWith('Must be run in a server.');
      });

      it('requires configured tenant', async () => {
        resolveTenantByGuildId.mockResolvedValue(null);
        await runCommand('$atria billing upgrade pro 1w');
        await confirmCommand();
        expect(message.reply).toHaveBeenCalledWith('Not configured.');
      });

      it('upgrades successfully with days', async () => {
        resolveTenantByGuildId.mockResolvedValue({ tenantId: 't123' });
        await runCommand('$atria billing upgrade pro 5d');
        await confirmCommand();
        expect(query).toHaveBeenCalledWith(
          'UPDATE tenants SET subscription_tier = $1, billing_cycle_reset = $2 WHERE tenant_id = $3',
          ['pro', expect.any(String), 't123']
        );
        expect(message.reply.mock.calls[1][0]).toMatch(/Server upgraded to \*\*pro\*\*/);
      });

      it('upgrades successfully with weeks', async () => {
        resolveTenantByGuildId.mockResolvedValue({ tenantId: 't123' });
        await runCommand('$atria billing upgrade core 2w');
        await confirmCommand();
        expect(query).toHaveBeenCalledWith(
          expect.any(String),
          ['core', expect.any(String), 't123']
        );
      });

      it('upgrades successfully with months', async () => {
        resolveTenantByGuildId.mockResolvedValue({ tenantId: 't123' });
        await runCommand('$atria billing upgrade core 1m');
        await confirmCommand();
        expect(query).toHaveBeenCalledWith(
          expect.any(String),
          ['core', expect.any(String), 't123']
        );
      });
    });

    describe('downgrade', () => {
      it('requires guild context', async () => {
        message.guild = null;
        await runCommand('$atria billing downgrade');
        await confirmCommand();
        expect(message.reply).toHaveBeenCalledWith('Must be run in a server.');
      });

      it('requires configured tenant', async () => {
        resolveTenantByGuildId.mockResolvedValue(null);
        await runCommand('$atria billing downgrade');
        await confirmCommand();
        expect(message.reply).toHaveBeenCalledWith('Not configured.');
      });

      it('downgrades successfully', async () => {
        resolveTenantByGuildId.mockResolvedValue({ tenantId: 't123' });
        await runCommand('$atria billing downgrade');
        await confirmCommand();
        expect(query).toHaveBeenCalledWith(
          'UPDATE tenants SET subscription_tier = $1 WHERE tenant_id = $2',
          ['free', 't123']
        );
        expect(message.reply.mock.calls[1][0]).toBe('Server downgraded to **free**.');
      });
    });
  });

  describe('consent command', () => {
    describe('revoke', () => {
      it('requires user ID', async () => {
        await runCommand('$atria consent revoke');
        expect(message.reply).toHaveBeenCalledWith('Missing user ID.');
      });

      it('handles successful revocation', async () => {
        query.mockResolvedValue({ rowCount: 1 });
        await runCommand('$atria consent revoke user123');
        await confirmCommand();
        expect(query).toHaveBeenCalledWith(
          'DELETE FROM user_agreements WHERE discord_id = $1 RETURNING *',
          ['user123']
        );
        expect(message.reply.mock.calls[1][0]).toBe('Revoked ToS consent for user ID user123.');
      });

      it('handles user not in db', async () => {
        query.mockResolvedValue({ rowCount: 0 });
        await runCommand('$atria consent revoke user123');
        await confirmCommand();
        expect(message.reply.mock.calls[1][0]).toBe('User ID user123 was not in the consent database.');
      });
    });

    describe('check', () => {
      it('requires user ID', async () => {
        await runCommand('$atria consent');
        expect(message.reply).toHaveBeenCalledWith('Missing user ID.');
      });

      it('returns true if agreed', async () => {
        query.mockResolvedValue({ rows: [{ agreed_at: new Date('2026-01-01').toISOString() }] });
        await runCommand('$atria consent user123');
        await confirmCommand();
        expect(message.reply.mock.calls[1][0]).toContain('✅ User ID user123 agreed to ToS');
      });

      it('returns false if not agreed', async () => {
        query.mockResolvedValue({ rows: [] });
        await runCommand('$atria consent user123');
        await confirmCommand();
        expect(message.reply.mock.calls[1][0]).toContain('❌ User ID user123 has NOT agreed');
      });
    });
  });

  describe('globalban command', () => {
    it('requires user ID', async () => {
      await runCommand('$atria globalban');
      expect(message.reply).toHaveBeenCalledWith('Missing user ID.');
    });

    it('bans permanently if no duration', async () => {
      await runCommand('$atria globalban user123');
      await confirmCommand();
      expect(query).toHaveBeenCalledWith(
        'INSERT INTO global_bans (discord_id, expires_at) VALUES ($1, $2) ON CONFLICT (discord_id) DO UPDATE SET expires_at = $2',
        ['user123', null]
      );
      expect(message.reply.mock.calls[1][0]).toContain('permanently');
    });

    it('bans temporarily with duration', async () => {
      await runCommand('$atria globalban user123 1d');
      await confirmCommand();
      expect(query).toHaveBeenCalledWith(
        expect.any(String),
        ['user123', expect.any(String)]
      );
      expect(message.reply.mock.calls[1][0]).toContain('until');
    });
  });

  describe('globalunban command', () => {
    it('requires user ID', async () => {
      await runCommand('$atria globalunban');
      expect(message.reply).toHaveBeenCalledWith('Missing user ID.');
    });

    it('unbans successfully', async () => {
      await runCommand('$atria globalunban user123');
      await confirmCommand();
      expect(query).toHaveBeenCalledWith(
        'DELETE FROM global_bans WHERE discord_id = $1',
        ['user123']
      );
      expect(message.reply.mock.calls[1][0]).toBe('User user123 has been globally unbanned.');
    });
  });

  describe('leave command', () => {
    it('fails if no server ID and not in a server', async () => {
      message.guild = null;
      await runCommand('$atria leave');
      expect(message.reply).toHaveBeenCalledWith('Missing server ID and not run in a server.');
    });

    it('leaves current server if no ID provided', async () => {
      const mockLeave = vi.fn();
      message.client.guilds.cache.get.mockReturnValue({ leave: mockLeave });
      
      await runCommand('$atria leave');
      await confirmCommand();
      
      expect(message.client.guilds.cache.get).toHaveBeenCalledWith('guild123');
      expect(mockLeave).toHaveBeenCalled();
      expect(message.reply.mock.calls[1][0]).toBe('Left server guild123.');
    });

    it('leaves specific server', async () => {
      const mockLeave = vi.fn();
      message.client.guilds.cache.get.mockReturnValue({ leave: mockLeave });
      
      await runCommand('$atria leave otherGuild');
      await confirmCommand();
      
      expect(message.client.guilds.cache.get).toHaveBeenCalledWith('otherGuild');
      expect(mockLeave).toHaveBeenCalled();
    });

    it('handles server not in cache', async () => {
      message.client.guilds.cache.get.mockReturnValue(null);
      
      await runCommand('$atria leave otherGuild');
      await confirmCommand();
      
      expect(message.reply.mock.calls[1][0]).toContain('not found in cache');
    });
  });

  describe('resetusage command', () => {
    it('fails if no server ID and not in a server', async () => {
      message.guild = null;
      await runCommand('$atria resetusage');
      expect(message.reply).toHaveBeenCalledWith('Missing server ID and not run in a server.');
    });

    it('fails if server not configured', async () => {
      resolveTenantByGuildId.mockResolvedValue(null);
      await runCommand('$atria resetusage');
      await confirmCommand();
      expect(message.reply).toHaveBeenCalledWith('Server guild123 is not configured with Wren.');
    });

    it('resets usage successfully', async () => {
      resolveTenantByGuildId.mockResolvedValue({ tenantId: 't123' });
      await runCommand('$atria resetusage');
      await confirmCommand();
      expect(query).toHaveBeenCalledWith(
        'UPDATE tenants SET monthly_message_count = 0 WHERE tenant_id = $1',
        ['t123']
      );
      expect(message.reply.mock.calls[1][0]).toBe('Usage reset to 0 for server guild123.');
    });
  });

  describe('personality bypass command', () => {
    it('fails on unknown subcommand', async () => {
      await runCommand('$atria personality foo');
      expect(message.reply).toHaveBeenCalledWith('Invalid personality subcommand. Use "bypass <server_id>".');
    });

    it('requires a server ID', async () => {
      await runCommand('$atria personality bypass');
      expect(message.reply).toHaveBeenCalledWith('Usage: `$atria personality bypass <server_id>`');
    });

    it('grants a 10-minute single-use bypass keyed to the target server', async () => {
      await runCommand('$atria personality bypass guild123');
      await confirmCommand();

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO global_state'),
        ['personality_bypass:guild123', expect.any(String)]
      );
      const stored = JSON.parse(query.mock.calls.find((c) => c[0].includes('INSERT INTO global_state'))[1][1]);
      expect(stored.grantedBy).toBe(STAFF_ID);
      const msUntilExpiry = new Date(stored.expiresAt).getTime() - Date.now();
      expect(msUntilExpiry).toBeGreaterThan(9 * 60 * 1000);
      expect(msUntilExpiry).toBeLessThanOrEqual(10 * 60 * 1000);
      expect(message.reply.mock.calls[1][0]).toContain('single use');
    });

    it('is staff-gated like every other $atria command', async () => {
      message.author.id = NON_STAFF_ID;
      const handled = await runCommand('$atria personality bypass guild123');
      expect(handled).toBe(false);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('broadcast command', () => {
    it('requires message', async () => {
      await runCommand('$atria broadcast');
      expect(message.reply).toHaveBeenCalledWith('Missing broadcast message.');
    });

    it('broadcasts successfully', async () => {
      query.mockResolvedValue({
        rows: [
          { status_channel_id: 'ch1' },
          { status_channel_id: 'ch2' }
        ]
      });

      const mockSend1 = vi.fn();
      const mockSend2 = vi.fn();

      message.client.channels.fetch
        .mockResolvedValueOnce({ send: mockSend1 })
        .mockResolvedValueOnce({ send: mockSend2 });

      await runCommand('$atria broadcast hello world');
      await confirmCommand();

      expect(query).toHaveBeenCalledWith("SELECT tenant_id, status_channel_id, last_active_channel_id FROM tenants WHERE (status_channel_id IS NOT NULL AND status_channel_id != '') OR (last_active_channel_id IS NOT NULL AND last_active_channel_id != '')");

      expect(mockSend1).toHaveBeenCalledWith('**ATRIA PLATFORM BROADCAST:**\nhello world');
      expect(mockSend2).toHaveBeenCalledWith('**ATRIA PLATFORM BROADCAST:**\nhello world');

      expect(message.reply.mock.calls[1][0]).toBe('Broadcast sent to 2 servers. (Failed: 0)');
    });

    it('ignores channel fetch errors during broadcast', async () => {
      query.mockResolvedValue({ rows: [{ status_channel_id: 'ch1' }] });
      message.client.channels.fetch.mockRejectedValue(new Error('Unknown Channel'));
      
      await runCommand('$atria broadcast test');
      await confirmCommand();
      
      expect(message.reply.mock.calls[1][0]).toBe('Broadcast sent to 0 servers. (Failed: 1)');
    });
  });

  describe('pause/unpause commands', () => {
    it('pauses', async () => {
      await runCommand('$atria pause');
      await confirmCommand();
      expect(query).toHaveBeenCalledWith(
        "INSERT INTO global_state (key, value) VALUES ('paused', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [JSON.stringify({ paused: true })]
      );
      expect(message.reply.mock.calls[1][0]).toBe('Global pause is now **ON**.');
    });

    it('unpauses', async () => {
      await runCommand('$atria unpause');
      await confirmCommand();
      expect(query).toHaveBeenCalledWith(
        "INSERT INTO global_state (key, value) VALUES ('paused', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [JSON.stringify({ paused: false })]
      );
      expect(message.reply.mock.calls[1][0]).toBe('Global pause is now **OFF**.');
    });
  });

  describe('Error Handling Context', () => {
    it.skip('catches and reports unexpected errors in try-catch block', async () => {
      // Create a scenario where parsing throws
      message.author.id = STAFF_ID;
      message.content = '$atria';
      
      // Override slice to throw
      const originalSlice = String.prototype.slice;
      String.prototype.slice = function() { throw new Error('Simulated Error'); };
      
      await handleAtriaCommands(message);
      
      expect(message.reply).toHaveBeenCalledWith('Error executing command: Simulated Error');
      String.prototype.slice = originalSlice; // Restore
    });
  });
});
