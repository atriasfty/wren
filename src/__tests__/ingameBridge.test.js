import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getModcalls: vi.fn(),
  findPlayer: vi.fn(),
  runAssistantPipeline: vi.fn(),
  executeTool: vi.fn(),
}));

vi.mock('../integrations/prc.js', () => ({
  getModcalls: mocks.getModcalls,
  findPlayer: mocks.findPlayer,
}));

vi.mock('../ai/pipeline.js', () => ({
  runAssistantPipeline: mocks.runAssistantPipeline,
}));

vi.mock('../ai/executor.js', () => ({
  executeTool: mocks.executeTool,
}));

describe('ingameBridge - pollModcallsFor', () => {
  let pollModcallsFor;
  let tenantCtx;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ pollModcallsFor } = await import('../discord/ingameBridge.js'));
    tenantCtx = {
      tenantId: 'guild-123',
      tenant: {
        inGameHandle: ':pm wren',
      },
    };
    mocks.getModcalls.mockResolvedValue([]);
    mocks.findPlayer.mockResolvedValue({ permission: 'Regular Player' });
    mocks.runAssistantPipeline.mockResolvedValue({ text: 'Hello back' });
    mocks.executeTool.mockResolvedValue({ success: true });
  });

  it('ignores modcalls not matching the bot handle or prefix', async () => {
    mocks.getModcalls.mockResolvedValue([
      { callerName: 'Player1', message: 'help me mod', timestamp: 100 },
      { callerName: 'Player2', message: ':pm bob hi', timestamp: 101 },
    ]);

    await pollModcallsFor(tenantCtx);

    expect(mocks.runAssistantPipeline).not.toHaveBeenCalled();
  });

  it('processes modcalls addressed to the bot and strips handle correctly', async () => {
    mocks.getModcalls.mockResolvedValue([
      { callerName: 'Player1', message: ':pm wren what is the status?', timestamp: 100 },
    ]);

    await pollModcallsFor(tenantCtx);

    expect(mocks.runAssistantPipeline).toHaveBeenCalledWith(tenantCtx, {
      question: 'what is the status?',
      actor: { kind: 'in_game', playerName: 'Player1', isStaff: false },
      isInGame: true,
    });
    expect(mocks.executeTool).toHaveBeenCalledWith(
      tenantCtx,
      'send_pm',
      { username: 'Player1', message: 'Hello back' },
      { kind: 'system' }
    );
  });

  it('processes modcalls with alternative casing or spaces in bot handle', async () => {
    mocks.getModcalls.mockResolvedValue([
      { callerName: 'Player1', message: ':pm   WREN  rules please', timestamp: 100 },
    ]);

    await pollModcallsFor(tenantCtx);

    expect(mocks.runAssistantPipeline).toHaveBeenCalledWith(tenantCtx, {
      question: 'rules please',
      actor: { kind: 'in_game', playerName: 'Player1', isStaff: false },
      isInGame: true,
    });
  });

  it('ignores empty questions after stripping handle', async () => {
    mocks.getModcalls.mockResolvedValue([
      { callerName: 'Player1', message: ':pm wren', timestamp: 100 },
      { callerName: 'Player2', message: ':pm wren     ', timestamp: 101 },
    ]);

    await pollModcallsFor(tenantCtx);

    expect(mocks.runAssistantPipeline).not.toHaveBeenCalled();
  });

  it('gracefully falls back to non-staff if findPlayer throws an error', async () => {
    mocks.getModcalls.mockResolvedValue([
      { callerName: 'Player1', message: ':pm wren help me', timestamp: 100 },
    ]);
    mocks.findPlayer.mockRejectedValue(new Error('Connection failure'));

    await pollModcallsFor(tenantCtx);

    expect(mocks.runAssistantPipeline).toHaveBeenCalledWith(tenantCtx, {
      question: 'help me',
      actor: { kind: 'in_game', playerName: 'Player1', isStaff: false },
      isInGame: true,
    });
  });

  it('continues processing subsequent modcalls if runAssistantPipeline throws an error on one', async () => {
    mocks.getModcalls.mockResolvedValue([
      { callerName: 'Player1', message: ':pm wren first question', timestamp: 100 },
      { callerName: 'Player2', message: ':pm wren second question', timestamp: 101 },
    ]);

    mocks.runAssistantPipeline
      .mockRejectedValueOnce(new Error('LLM rate limit error'))
      .mockResolvedValueOnce({ text: 'Hello back' });

    await pollModcallsFor(tenantCtx);

    expect(mocks.runAssistantPipeline).toHaveBeenCalledTimes(2);
    expect(mocks.executeTool).toHaveBeenCalledTimes(1);
    expect(mocks.executeTool).toHaveBeenCalledWith(
      tenantCtx,
      'send_pm',
      { username: 'Player2', message: 'Hello back' },
      { kind: 'system' }
    );
  });

  it('handles empty timestamps or missing timestamp fields in modcall list safely', async () => {
    mocks.getModcalls.mockResolvedValue([
      { callerName: 'Player1', message: ':pm wren test', timestamp: undefined },
      { callerName: 'Player2', message: ':pm wren test2', timestamp: null },
    ]);

    await expect(pollModcallsFor(tenantCtx)).resolves.not.toThrow();
  });
});
