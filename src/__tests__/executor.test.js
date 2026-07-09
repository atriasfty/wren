import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTool } from '../ai/executor.js';

// Setup mocks
const mocks = {
  banPlayer: vi.fn(),
  kickPlayer: vi.fn(),
  killPlayer: vi.fn(),
  tpPlayer: vi.fn(),
  sendPrivateMessage: vi.fn(),
  modPlayer: vi.fn(),
  unmodPlayer: vi.fn(),
  adminPlayer: vi.fn(),
  unadminPlayer: vi.fn(),
  getOnlinePlayers: vi.fn(),
  getServerInfo: vi.fn(),
  getServerStaff: vi.fn(),
  findPlayer: vi.fn(),
  getCommandLogs: vi.fn(),
  getRobloxUserId: vi.fn(),
  getJoinLogs: vi.fn(),
  getKillLogs: vi.fn(),
  logPunishment: vi.fn(),
  getPunishments: vi.fn(),
  audit: vi.fn(),
  addMemory: vi.fn(),
};

vi.mock('../integrations/prc.js', () => ({
  banPlayer: (...args) => mocks.banPlayer(...args),
  kickPlayer: (...args) => mocks.kickPlayer(...args),
  killPlayer: (...args) => mocks.killPlayer(...args),
  tpPlayer: (...args) => mocks.tpPlayer(...args),
  sendPrivateMessage: (...args) => mocks.sendPrivateMessage(...args),
  modPlayer: (...args) => mocks.modPlayer(...args),
  unmodPlayer: (...args) => mocks.unmodPlayer(...args),
  adminPlayer: (...args) => mocks.adminPlayer(...args),
  unadminPlayer: (...args) => mocks.unadminPlayer(...args),
  getOnlinePlayers: (...args) => mocks.getOnlinePlayers(...args),
  getServerInfo: (...args) => mocks.getServerInfo(...args),
  getServerStaff: (...args) => mocks.getServerStaff(...args),
  findPlayer: (...args) => mocks.findPlayer(...args),
  getCommandLogs: (...args) => mocks.getCommandLogs(...args),
  getRobloxUserId: (...args) => mocks.getRobloxUserId(...args),
  getJoinLogs: (...args) => mocks.getJoinLogs(...args),
  getKillLogs: (...args) => mocks.getKillLogs(...args),
}));

vi.mock('../integrations/pow.js', () => ({
  logPunishment: (...args) => mocks.logPunishment(...args),
  getPunishments: (...args) => mocks.getPunishments(...args),
}));

vi.mock('../tenant/store.js', () => ({
  audit: (...args) => mocks.audit(...args),
  addMemory: (...args) => mocks.addMemory(...args),
}));

// Mock policy gate specifically so we can control it in tests
vi.mock('../ai/policy.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    canRunTool: vi.fn(() => true),
    denialReason: vi.fn(() => null),
  };
});

describe('executeTool', () => {
  let tenantCtx;
  let actor;

  beforeEach(() => {
    vi.clearAllMocks();
    tenantCtx = {
      tenantId: 'guild-123',
      tenant: {
        securityRoleId: 'role-sec',
      },
      policy: {},
      roleSlots: {},
    };
    actor = { kind: 'discord', member: { id: 'moderator-123' } };
  });

  describe('safety & target validation (rejectTarget)', () => {
    it('blocks mass-action targets', async () => {
      const result = await executeTool(tenantCtx, 'ban_player', { username: '  EVERYONE ' }, actor);
      expect(result).toEqual({ success: false, error: 'Mass actions are not allowed. Specify a single player.' });
      expect(mocks.banPlayer).not.toHaveBeenCalled();
    });

    it('blocks targeting the bot itself', async () => {
      const result = await executeTool(tenantCtx, 'kill_player', { username: 'wren' }, actor);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/reserved to stop the bot from being targeted/);
      expect(mocks.killPlayer).not.toHaveBeenCalled();
    });

    it('blocks target usernames that are too short', async () => {
      const result = await executeTool(tenantCtx, 'kick_player', { username: 'a' }, actor);
      expect(result).toEqual({ success: false, error: 'Target username too short.' });
    });

    it('blocks target usernames that look like Discord IDs', async () => {
      const result = await executeTool(tenantCtx, 'ban_player', { username: '1234567890123' }, actor);
      expect(result).toEqual({ success: false, error: 'That looks like a Discord ID, not a Roblox username.' });
    });

    it('allows valid target usernames', async () => {
      mocks.killPlayer.mockResolvedValue({ actualUsername: 'ValidUser' });
      const result = await executeTool(tenantCtx, 'kill_player', { username: 'ValidUser' }, actor);
      expect(result.success).toBe(true);
    });
  });

  describe('moderation tool flows & auditing', () => {
    it('calls prc.banPlayer and audits success', async () => {
      mocks.banPlayer.mockResolvedValue({ actualUsername: 'BannedPlayer' });

      const result = await executeTool(tenantCtx, 'ban_player', { username: 'BannedPlayer', reason: 'Trolling', duration: 60 }, actor);
      
      expect(mocks.banPlayer).toHaveBeenCalledWith(tenantCtx, 'BannedPlayer', 'Trolling', 60);
      expect(result).toEqual({
        success: true,
        username: 'BannedPlayer',
        canonicalUsername: 'BannedPlayer',
        query: 'BannedPlayer',
        reason: 'Trolling',
        duration: 60,
      });
      expect(mocks.audit).toHaveBeenCalledWith({
        tenantId: 'guild-123',
        actor: 'discord:moderator-123',
        action: 'ban_player',
        target: JSON.stringify({ username: 'BannedPlayer', reason: 'Trolling', duration: 60 }),
        metadata: { ok: true },
      });
    });

    it('audits failure if moderation tool throws error', async () => {
      mocks.kickPlayer.mockRejectedValue(new Error('ERLC API Offline'));

      const result = await executeTool(tenantCtx, 'kick_player', { username: 'BadUser', reason: 'Spamming' }, actor);

      expect(result).toEqual({ success: false, error: 'ERLC API Offline' });
      expect(mocks.audit).toHaveBeenCalledWith({
        tenantId: 'guild-123',
        actor: 'discord:moderator-123',
        action: 'kick_player',
        target: JSON.stringify({ username: 'BadUser', reason: 'Spamming' }),
        metadata: { ok: false, error: 'ERLC API Offline' },
      });
    });

    it('respects denial reason from policy gate', async () => {
      const { denialReason } = await import('../ai/policy.js');
      denialReason.mockReturnValueOnce('Permission denied: tool requires owner');

      const result = await executeTool(tenantCtx, 'admin_player', { username: 'SomeUser' }, actor);
      expect(result).toEqual({ success: false, error: 'Permission denied: tool requires owner' });
      expect(mocks.adminPlayer).not.toHaveBeenCalled();
    });
  });

  describe('special composite mod tools', () => {
    it('bring_all_staff teleports all online staff members to target', async () => {
      mocks.getOnlinePlayers.mockResolvedValue([
        { username: 'Staff1', permission: 'Server Moderator' },
        { username: 'Staff2', permission: 'Server Administrator' },
        { username: 'Regular1', permission: 'Regular Player' },
      ]);
      mocks.tpPlayer.mockResolvedValue({ actualUsername1: 'Staff1', actualUsername2: 'TargetUser' });

      const result = await executeTool(tenantCtx, 'bring_all_staff', { destination_player: 'TargetUser' }, actor);
      expect(mocks.tpPlayer).toHaveBeenCalledTimes(2);
      expect(result.staff).toEqual(['Staff1', 'Staff2']);
    });

    it('pm_all_staff sends private message to all online staff', async () => {
      mocks.getOnlinePlayers.mockResolvedValue([
        { username: 'Staff1', permission: 'Server Moderator' },
        { username: 'Regular1', permission: 'Regular Player' },
      ]);
      mocks.sendPrivateMessage.mockResolvedValue({ actualUsername: 'Staff1' });

      const result = await executeTool(tenantCtx, 'pm_all_staff', { message: 'Emergency!' }, actor);
      expect(mocks.sendPrivateMessage).toHaveBeenCalledTimes(1);
      expect(mocks.sendPrivateMessage).toHaveBeenCalledWith(tenantCtx, 'Staff1', 'Emergency!');
      expect(result.staff).toEqual(['Staff1']);
    });
  });

  describe('POW log punishments', () => {
    it('rejects log_punishment if actor is not Discord', async () => {
      const ingameActor = { kind: 'in_game', playerName: 'Mod123' };
      const result = await executeTool(tenantCtx, 'log_punishment', { username: 'User1', type: 'Warn', reason: 'Trolling' }, ingameActor);
      expect(result).toEqual({ success: false, error: 'log_punishment requires a Discord moderator.' });
    });

    it('successfully calls logPunishment if Discord actor is present', async () => {
      mocks.logPunishment.mockResolvedValue({ player: 'User1', type: 'Warn', reason: 'Trolling' });
      const result = await executeTool(tenantCtx, 'log_punishment', { username: 'User1', type: 'Warn', reason: 'Trolling' }, actor);
      expect(mocks.logPunishment).toHaveBeenCalledWith(tenantCtx, 'User1', 'moderator-123', 'Warn', 'Trolling', undefined);
      expect(result.success).toBe(true);
    });

    it('passes moderator_roblox_username through to logPunishment', async () => {
      mocks.logPunishment.mockResolvedValue({ player: 'User1', type: 'Warn', reason: 'Trolling' });
      await executeTool(tenantCtx, 'log_punishment', { username: 'User1', type: 'Warn', reason: 'Trolling', moderator_roblox_username: 'ModRblx' }, actor);
      expect(mocks.logPunishment).toHaveBeenCalledWith(tenantCtx, 'User1', 'moderator-123', 'Warn', 'Trolling', 'ModRblx');
    });
  });

  describe('Discord environment actions', () => {
    let mockGuild;
    beforeEach(() => {
      mockGuild = {
        roles: {
          cache: {
            get: vi.fn((id) => id === 'role-sec' ? { id: 'role-sec', name: 'Security' } : null),
          },
        },
        channels: {
          cache: {
            filter: vi.fn(() => ({
              map: vi.fn(() => [{ name: 'general', id: '111', type: 'Text' }]),
            })),
          },
        },
      };
      actor.guild = mockGuild;
    });

    it('fails get_all_channels for non-Discord actors', async () => {
      const apiActor = { kind: 'api' };
      const result = await executeTool(tenantCtx, 'get_all_channels', {}, apiActor);
      expect(result).toEqual({ success: false, error: 'This action is only available via Discord.' });
    });

    it('returns channels for the configured security role', async () => {
      const result = await executeTool(tenantCtx, 'get_all_channels', {}, actor);
      expect(result.success).toBe(true);
      expect(result.channels[0].name).toBe('general');
    });
  });

  describe('Save Memory', () => {
    it('saves server memory if actor has policy permissions', async () => {
      const result = await executeTool(tenantCtx, 'save_memory', { type: 'server', content: 'Do not run red lights' }, actor);
      expect(mocks.addMemory).toHaveBeenCalledWith({
        tenantId: 'guild-123',
        scope: 'server',
        content: 'Do not run red lights',
        addedBy: 'discord:moderator-123',
      });
      expect(result.success).toBe(true);
    });

    it('denies server memory save if policy fails', async () => {
      const { canRunTool } = await import('../ai/policy.js');
      canRunTool.mockReturnValueOnce(false);

      const result = await executeTool(tenantCtx, 'save_memory', { type: 'server', content: 'Do not run red lights' }, actor);
      expect(result).toEqual({ success: false, error: 'Permission denied: only staff can save server memories.' });
      expect(mocks.addMemory).not.toHaveBeenCalled();
    });

    it('saves user memory without checking staff permissions', async () => {
      const result = await executeTool(tenantCtx, 'save_memory', { type: 'user', content: 'My favorite color is green' }, actor);
      expect(mocks.addMemory).toHaveBeenCalledWith({
        tenantId: 'guild-123',
        scope: 'user',
        userKey: 'discord:moderator-123',
        content: 'My favorite color is green',
        addedBy: 'discord:moderator-123',
      });
      expect(result.success).toBe(true);
    });
  });
});
