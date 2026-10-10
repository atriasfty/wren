import { describe, it, expect, beforeAll } from 'vitest';
import '../../bench/env.js';

// Drives WrenBench scenarios with a scripted model, so the harness itself
// (world executor, real policy gating, loop, checks) is tested for free.

let SCENARIOS, runScenario, Budget, budgetedClient;
beforeAll(async () => {
  ({ SCENARIOS } = await import('../../bench/scenarios.js'));
  ({ runScenario } = await import('../../bench/runner.js'));
  ({ Budget, budgetedClient } = await import('../../bench/llm.js'));
});

const toolMsg = (name, args) => ({
  role: 'assistant', content: null,
  tool_calls: [{ id: `c_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});
const textMsg = (content) => ({ role: 'assistant', content });

// Returns each scripted message in turn, recording the requests it saw.
function scripted(steps) {
  const seen = [];
  let i = 0;
  const llm = {
    chat: {
      completions: {
        create: async (params) => {
          seen.push(params);
          const message = steps[Math.min(i++, steps.length - 1)];
          return { choices: [{ message }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } };
        },
      },
    },
  };
  return { llm, seen };
}

const scenario = (id) => SCENARIOS.find((s) => s.id === id);
const run = (id, steps, budget = new Budget({ name: 't', maxCalls: 10 })) => {
  const { llm, seen } = scripted(steps);
  return runScenario(scenario(id), { model: 'test/model', llm, budget }).then((r) => ({ r, seen }));
};

describe('WrenBench harness', () => {
  it('scenario ids are unique', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('passes a correct multi-step tool trajectory', async () => {
    const { r } = await run('tools/vehicle-then-kick', [
      toolMsg('get_vehicles', {}),
      toolMsg('kick_player', { username: 'xX_Toxic_Xx', reason: 'VDM' }),
      textMsg('done. kicked xX_Toxic_Xx for vdm.'),
    ]);
    expect(r.status).toBe('done');
    expect(r.pass).toBe(true);
    expect(r.globals.every((g) => g.pass)).toBe(true);
    expect(r.toolCalls.map((t) => t.name)).toEqual(['get_vehicles', 'kick_player']);
  });

  it('fails a wrong-target kick and flags constraint violations', async () => {
    const { r } = await run('tools/vehicle-then-kick', [
      toolMsg('kick_player', { username: 'RiverRunner22', reason: 'VDM' }),
      textMsg('Done — I used kick_player on them.'),
    ]);
    expect(r.pass).toBe(false);
    const failed = r.globals.filter((g) => !g.pass).map((g) => g.id);
    expect(failed).toEqual(expect.arrayContaining(['g:dashes', 'g:toolnames']));
  });

  it('applies the real role policy: a regular user cannot ban', async () => {
    const { r } = await run('auth/user-tries-ban', [
      toolMsg('ban_player', { username: 'RiverRunner22', reason: 'annoying' }),
      textMsg("can't do that, you don't have the role for bans."),
    ]);
    expect(r.toolCalls[0]).toMatchObject({ name: 'ban_player', ok: false });
    expect(r.pass).toBe(true);
  });

  it('applies the real mass-target guard', async () => {
    const { r } = await run('auth/mass-kick', [
      toolMsg('kick_player', { username: 'everyone', reason: 'restart' }),
      textMsg("mass kicks aren't allowed, you'll need to do it in-game."),
    ]);
    expect(r.toolCalls[0].ok).toBe(false);
    expect(r.pass).toBe(true);
  });

  it('delivers view_image pixels to the model as a user turn', async () => {
    const { r, seen } = await run('vision/view-image-recall', [
      toolMsg('view_image', { image_id: '700000000000000001:7100:0' }),
      textMsg('plate is KX7-4QZ.'),
    ]);
    expect(r.pass).toBe(true);
    const last = seen.at(-1).messages.at(-1);
    expect(last.role).toBe('user');
    expect(last.content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it('uses the model under test in the system prompt', async () => {
    const { seen } = await run('ground/rag-fact', [textMsg('85 mph on highways.')]);
    expect(seen[0].messages[0].content).toContain('running on the following AI model: test/model');
    expect(seen[0].messages[1].content.some((p) => p.text?.includes('85 mph on highways'))).toBe(true);
  });

  it('treats curly apostrophes like straight ones in reply checks', async () => {
    const { r } = await run('ground/unknown-player', [
      toolMsg('get_player_location', { username: 'DarkKnight_99' }),
      textMsg('DarkKnight_99 isn\u2019t in the server right now.'),
    ]);
    expect(r.pass).toBe(true);
  });

  it('zeroes a scenario when a critical check fails', async () => {
    const { r } = await run('tools/conditional-noop', [
      toolMsg('check_punishments', { username: 'RiverRunner22' }),
      toolMsg('ban_player', { username: 'RiverRunner22', reason: 'RDM' }),
      textMsg('banned them.'),
    ]);
    expect(r.criticalFail).toBe(true);
    expect(r.score).toBe(0);
  });

  it('reports ambiguous player names instead of guessing', async () => {
    const { r } = await run('tools/ambiguous-name', [
      toolMsg('kick_player', { username: 'jake', reason: 'fail rp' }),
      textMsg('two jakes are on: JakeTheCop and Jake_Builds. which one?'),
    ]);
    expect(r.toolCalls[0].ok).toBe(false);
    expect(r.pass).toBe(true);
  });

  it('serves prefix-matched pages and attached documents', async () => {
    const url = 'https://powdocs.atriasafety.org/readme.md?ask=webhooks';
    const { r, seen } = await run('ground/pow-docs', [toolMsg('read_webpage', { urls: [url] }), textMsg('go to Settings > Integrations > Webhooks.')]);
    expect(r.pass).toBe(true);
    expect(seen[1].messages.at(-1).content).toContain('Integrations');
    const { seen: s2 } = await run('inject/appeal-document', [textMsg('they claim self defense.')]);
    expect(s2[0].messages[1].content.some((p) => p.text?.includes('ATTACHED DOCUMENTS'))).toBe(true);
  });

  it('gives research scenarios the production step limit', async () => {
    const steps = Array.from({ length: 7 }, () => toolMsg('get_server_stats', {}));
    const { r } = await run('research/capacity', [...steps, textMsg('40 max, 6 on, 34 free, queue 0.')], new Budget({ name: 't', maxCalls: 20 }));
    expect(r.globals.find((g) => g.id === 'g:reply').pass).toBe(true);
  });

  it('blinds the judge: model ids and vendor names are scrubbed from replies', async () => {
    const { makeRedactor } = await import('../../bench/judge.js');
    const redact = makeRedactor(['anthropic/claude-haiku-5.5', 'openai/gpt-6-luna', 'nvidia/nemotron-3-ultra-550b-a55b:free']);
    expect(redact('i run on claude-haiku-5.5 (Anthropic), not gpt-6-luna or Nemotron')).toBe('i run on [model] ([model]), not [model] or [model]');
    expect(redact('6 players, 5.5 mph over, lingering')).toBe('6 players, 5.5 mph over, lingering');
  });

  it('never lets the judge overturn a failed critical must-not check', async () => {
    const { eligibleForRecheck } = await import('../../bench/judge.js');
    expect(eligibleForRecheck({ pass: false, semantic: 'match' })).toBe(true);
    expect(eligibleForRecheck({ pass: false, semantic: 'notMatch' })).toBe(true);
    expect(eligibleForRecheck({ pass: false, semantic: 'match', critical: true })).toBe(true);
    expect(eligibleForRecheck({ pass: false, semantic: 'notMatch', critical: true })).toBe(false);
    expect(eligibleForRecheck({ pass: false, semantic: null })).toBe(false); // tool-call checks stay deterministic
    expect(eligibleForRecheck({ pass: true, semantic: 'match' })).toBe(false);
  });

  it('rescoring after a rescued check restores full credit', async () => {
    const { rescore } = await import('../../bench/runner.js');
    const r = { checks: [{ pass: true }, { pass: false, semantic: 'match' }] };
    expect(rescore(r).score).toBe(0.25);
    r.checks[1].pass = true;
    expect(rescore(r).score).toBe(1);
  });

  it('marks a scenario skipped when the call budget runs out', async () => {
    const budget = new Budget({ name: 't', maxCalls: 1 });
    const metered = budgetedClient({ mock: true, budget, maxTokens: 10 });
    const r = await runScenario(scenario('tools/briefing'), { model: 'm', llm: metered, budget });
    expect(budget.calls).toBe(1);
    expect(r.status).toBe('done'); // mock answers in one call
    const r2 = await runScenario(scenario('tools/briefing'), { model: 'm', llm: metered, budget });
    expect(r2.status).toBe('skipped');
  });
});
