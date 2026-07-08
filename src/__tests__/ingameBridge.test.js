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
  let playerSessions;
  let tenantCtx;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../discord/ingameBridge.js');
    pollModcallsFor = mod.pollModcallsFor;
    playerSessions = mod.playerSessions;
    playerSessions.clear();
    mod.lastPollTs.clear();

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
      history: [],
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
      history: [],
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
      history: [],
    });
  });

  it('continues processing subsequent modcalls if runAssistantPipeline throws an error on one, and notifies the failed player', async () => {
    mocks.getModcalls.mockResolvedValue([
      { callerName: 'Player1', message: ':pm wren first question', timestamp: 100 },
      { callerName: 'Player2', message: ':pm wren second question', timestamp: 101 },
    ]);

    mocks.runAssistantPipeline
      .mockRejectedValueOnce(new Error('LLM rate limit error'))
      .mockResolvedValueOnce({ text: 'Hello back' });

    await pollModcallsFor(tenantCtx);

    expect(mocks.runAssistantPipeline).toHaveBeenCalledTimes(2);
    expect(mocks.executeTool).toHaveBeenCalledTimes(2);
    expect(mocks.executeTool).toHaveBeenCalledWith(
      tenantCtx,
      'send_pm',
      { username: 'Player1', message: 'Sorry, something went wrong processing your request. Please try again.' },
      { kind: 'system' }
    );
    expect(mocks.executeTool).toHaveBeenCalledWith(
      tenantCtx,
      'send_pm',
      { username: 'Player2', message: 'Hello back' },
      { kind: 'system' }
    );
  });

  it('retries a failed modcall on the next sweep instead of silently dropping it forever', async () => {
    mocks.getModcalls.mockResolvedValueOnce([
      { callerName: 'Player1', message: ':pm wren first question', timestamp: 100 },
    ]);
    mocks.runAssistantPipeline.mockRejectedValueOnce(new Error('transient failure'));

    await pollModcallsFor(tenantCtx);

    // The cursor must not have advanced past the failed modcall's timestamp.
    mocks.getModcalls.mockResolvedValueOnce([
      { callerName: 'Player1', message: ':pm wren first question', timestamp: 100 },
    ]);
    mocks.runAssistantPipeline.mockResolvedValueOnce({ text: 'answer on retry' });

    await pollModcallsFor(tenantCtx);

    expect(mocks.getModcalls.mock.calls[1][1].sinceTs).toBeLessThan(100);
    expect(mocks.runAssistantPipeline).toHaveBeenCalledTimes(2);
    expect(mocks.executeTool).toHaveBeenCalledWith(
      tenantCtx,
      'send_pm',
      { username: 'Player1', message: 'answer on retry' },
      { kind: 'system' }
    );
  });

  it('does not let an earlier failure block a later, independent modcall in the same sweep', async () => {
    mocks.getModcalls.mockResolvedValue([
      { callerName: 'Player1', message: ':pm wren first question', timestamp: 100 },
      { callerName: 'Player2', message: ':pm wren second question', timestamp: 101 },
    ]);
    mocks.runAssistantPipeline
      .mockRejectedValueOnce(new Error('LLM rate limit error'))
      .mockResolvedValueOnce({ text: 'Hello back' });

    await pollModcallsFor(tenantCtx);

    // Both were attempted in this sweep even though the first failed.
    expect(mocks.runAssistantPipeline).toHaveBeenNthCalledWith(1, tenantCtx, expect.objectContaining({ question: 'first question' }));
    expect(mocks.runAssistantPipeline).toHaveBeenNthCalledWith(2, tenantCtx, expect.objectContaining({ question: 'second question' }));
  });

  it('handles empty timestamps or missing timestamp fields in modcall list safely', async () => {
    mocks.getModcalls.mockResolvedValue([
      { callerName: 'Player1', message: ':pm wren test', timestamp: undefined },
      { callerName: 'Player2', message: ':pm wren test2', timestamp: null },
    ]);

    await expect(pollModcallsFor(tenantCtx)).resolves.not.toThrow();
  });

  it('retains conversational history across subsequent PMs within the session TTL', async () => {
    mocks.getModcalls.mockResolvedValue([
      { callerName: 'Player1', message: ':pm wren question 1', timestamp: 100 },
    ]);
    mocks.runAssistantPipeline.mockResolvedValueOnce({ text: 'answer 1' });

    await pollModcallsFor(tenantCtx);

    expect(mocks.runAssistantPipeline).toHaveBeenLastCalledWith(tenantCtx, {
      question: 'question 1',
      actor: { kind: 'in_game', playerName: 'Player1', isStaff: false },
      isInGame: true,
      history: [],
    });

    // Run second PM
    mocks.getModcalls.mockResolvedValue([
      { callerName: 'Player1', message: ':pm wren question 2', timestamp: 101 },
    ]);
    mocks.runAssistantPipeline.mockResolvedValueOnce({ text: 'answer 2' });

    await pollModcallsFor(tenantCtx);

    expect(mocks.runAssistantPipeline).toHaveBeenLastCalledWith(tenantCtx, {
      question: 'question 2',
      actor: { kind: 'in_game', playerName: 'Player1', isStaff: false },
      isInGame: true,
      history: [
        { role: 'user', content: 'question 1' },
        { role: 'assistant', content: 'answer 1' },
      ],
    });
  });

  it('expires session history and starts clean if time exceeds session TTL', async () => {
    const mockDateNow = vi.spyOn(Date, 'now');
    mockDateNow.mockReturnValue(1000);

    mocks.getModcalls.mockResolvedValue([
      { callerName: 'Player1', message: ':pm wren question 1', timestamp: 100 },
    ]);
    mocks.runAssistantPipeline.mockResolvedValueOnce({ text: 'answer 1' });

    await pollModcallsFor(tenantCtx);

    // Jump forward by 6 minutes (TTL is 5 minutes)
    mockDateNow.mockReturnValue(1000 + 6 * 60 * 1000);

    mocks.getModcalls.mockResolvedValue([
      { callerName: 'Player1', message: ':pm wren question 2', timestamp: 101 },
    ]);
    mocks.runAssistantPipeline.mockResolvedValueOnce({ text: 'answer 2' });

    await pollModcallsFor(tenantCtx);

    // The history should be empty because session expired
    expect(mocks.runAssistantPipeline).toHaveBeenLastCalledWith(tenantCtx, {
      question: 'question 2',
      actor: { kind: 'in_game', playerName: 'Player1', isStaff: false },
      isInGame: true,
      history: [],
    });

    mockDateNow.mockRestore();
  });
});
