#!/usr/bin/env node
// WrenBench CLI. See bench/README.md.
import './env.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCENARIOS, CATEGORIES } from './scenarios.js';
import { buildHardSuite, HARD_CATEGORIES } from './hard/index.js';
import { WEB_LIVE, WEB_CATEGORIES } from './scenarios/web-live.js';
import { searchProvider, searchTimings } from './liveWeb.js';
import { runScenario, rescore } from './runner.js';
import { Budget, budgetedClient } from './llm.js';
import { isArmorModel, apiModel, withArmor } from './armor.js';
import { judgeAbsolute, judgePairwise, judgeRequirement, makeRedactor, eligibleForRecheck, recheckTarget } from './judge.js';
import { claudeCodeClient, parseClaudeCodeJudge } from './claudeCode.js';
import { summarize, printSummary, printFailures, score100, green, red, yellow, dim, bold } from './report.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const HELP = `
WrenBench: benchmark models on the things Wren actually does.

Usage:
  npm run bench -- --models <a,b,...> [options]

Options:
  --models a,b        OpenRouter model ids (first one is the pairwise baseline).
                      Append +armor to run a model with OpenRouter Armor, e.g.
                      openai/gpt-6-luna,openai/gpt-6-luna+armor for an A/B
  --armor-mode enforce|audit  enforce blocks flagged tool calls; audit only
                      records verdicts                            [enforce]
  --armor-rules file  JSON classifier_context to use instead of bench/armor.js
  --suite core|hard   core: 142 hand-written scenarios (default). hard: WrenBench-Hard,
                      generated 40-player worlds, flaky tools, multi-turn, red-team,
                      pass/fail scoring with a critical-failure penalty. web: live
                      internet questions answered with real search results
  --search brave|exa|exa-answer  search provider for --suite web [brave]
                      (exa-answer: Exa's Answer API, a cited answer instead of results)
  --search-count N    results per web search for --suite web       [4]
  --seed N            hard suite world seed (default 1; a new seed = fresh worlds/answers)
  --judge <model>     judge for persona rubric + pairwise A/B (optional): an
                      OpenRouter model id, or claude-code[:<model>] to use the
                      Claude Code CLI (claude -p) with its existing login
  --max-calls N       hard cap on API calls for the whole run   [400]
  --max-cost USD      stop once reported spend reaches this      [5]
  --max-tokens N      max output tokens per call (production sets none) [6000]
  --repeats K         run each scenario K times (pass^K)         [1]
  --only x,y          only scenarios whose id/category contains x or y
  --neutral           minimal system prompt instead of Wren's (control run)
  --no-vision         skip image scenarios (for text-only models)
  --concurrency N     scenarios in flight per model (1 for :free) [4]
  --model-concurrency N  models benchmarked at the same time     [1]
  --no-semantic       don't let the judge re-check failed reply-text checks
  --out <file>        results JSON path            [bench/results/<time>.json]
  --verbose           print every scenario, full replies
  --list              list scenarios and exit (no API calls)
  --report a.json,b.json  merge saved result files into one leaderboard (no API calls);
                      later files replace earlier results per scenario; --models filters
  --mock              fake model, no network, no cost (harness check)

API key: WRENBENCH_API_KEY, falling back to OPENROUTER_API_KEY (.env).
`;

function parseArgs(argv) {
  const o = { suite: 'core', seed: 1, maxCalls: 400, maxCost: 5, maxTokens: 6000, repeats: 1, concurrency: 4, modelConcurrency: 1, semantic: true, models: [], only: [] };
  const take = (i) => { if (argv[i + 1] == null) throw new Error(`${argv[i]} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--models': case '--model': o.models.push(...take(i).split(',').map((s) => s.trim()).filter(Boolean)); i++; break;
      case '--judge': o.judge = take(i); i++; break;
      case '--armor-mode': o.armorMode = take(i); i++; break;
      case '--armor-rules': o.armorRules = take(i); i++; break;
      case '--max-calls': o.maxCalls = Number(take(i)); i++; break;
      case '--max-cost': o.maxCost = Number(take(i)); i++; break;
      case '--max-tokens': o.maxTokens = Number(take(i)); i++; break;
      case '--repeats': o.repeats = Math.max(1, Number(take(i))); i++; break;
      case '--only': o.only.push(...take(i).split(',').map((s) => s.trim()).filter(Boolean)); i++; break;
      case '--concurrency': o.concurrency = Math.max(1, Number(take(i))); i++; break;
      case '--model-concurrency': o.modelConcurrency = Math.max(1, Number(take(i))); i++; break;
      case '--no-semantic': o.semantic = false; break;
      case '--out': o.out = take(i); i++; break;
      case '--neutral': o.neutral = true; break;
      case '--no-vision': o.noVision = true; break;
      case '--verbose': case '-v': o.verbose = true; break;
      case '--list': o.list = true; break;
      case '--suite': o.suite = take(i); i++; break;
      case '--search': o.search = take(i); i++; break;
      case '--search-count': o.searchCount = Number(take(i)); i++; break;
      case '--seed': o.seed = Number(take(i)); i++; break;
      case '--report': o.report = take(i).split(',').map((x) => x.trim()).filter(Boolean); i++; break;
      case '--mock': o.mock = true; break;
      case '--help': case '-h': o.help = true; break;
      default: throw new Error(`unknown option ${a}`);
    }
  }
  for (const k of ['maxCalls', 'maxCost', 'maxTokens', 'repeats', 'concurrency', 'modelConcurrency']) {
    if (!Number.isFinite(o[k]) || o[k] <= 0) throw new Error(`--${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())} must be a positive number`);
  }
  return o;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

function selectScenarios(o, all) {
  return all.filter((s) => {
    if (o.only.length && !o.only.some((q) => s.id.includes(q) || s.category === q)) return false;
    if (o.noVision && s.category === 'vision') return false;
    if (o.neutral && s.neutralOk === false) return false;
    return true;
  });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return; }
  if (o.report) { mergeReport(o.report, { verbose: o.verbose, only: o.models }); return; }

  if (!['core', 'hard', 'web'].includes(o.suite)) throw new Error('--suite must be core, hard or web');
  o.armorMode ||= 'enforce';
  if (!['enforce', 'audit'].includes(o.armorMode)) throw new Error('--armor-mode must be enforce or audit');
  if (o.armorRules && !fs.existsSync(o.armorRules)) throw new Error(`--armor-rules: ${o.armorRules} not found`);
  if (o.search) {
    if (!['brave', 'exa', 'exa-answer'].includes(o.search)) throw new Error('--search must be brave, exa or exa-answer');
    process.env.WRENBENCH_SEARCH = o.search;
  }
  if (o.searchCount != null) {
    if (!Number.isInteger(o.searchCount) || o.searchCount < 1 || o.searchCount > 10) throw new Error('--search-count must be 1-10');
    process.env.WRENBENCH_SEARCH_COUNT = String(o.searchCount);
  }
  if (!Number.isInteger(o.seed) || o.seed < 1) throw new Error('--seed must be a positive integer');
  const hard = o.suite === 'hard';
  const web = o.suite === 'web';
  const scenarios = selectScenarios(o, hard ? await buildHardSuite(o.seed) : web ? WEB_LIVE : SCENARIOS);
  const categoryOrder = hard ? HARD_CATEGORIES : web ? WEB_CATEGORIES : CATEGORIES;
  if (o.list) {
    for (const cat of categoryOrder) {
      const rows = scenarios.filter((s) => s.category === cat);
      if (!rows.length) continue;
      console.log(bold(`\n${cat}`));
      for (const s of rows) console.log(`  ${s.id.padEnd(30)} ${dim(`~${s.estCalls ?? 2} calls${s.judge ? ', judged' : ''}`)}  ${s.description}`);
    }
    const est = scenarios.reduce((a, s) => a + (s.estCalls ?? 2), 0);
    console.log(dim(`\n${scenarios.length} scenarios, ~${est} calls per model per repeat`));
    return;
  }
  if (!scenarios.length) throw new Error('no scenarios selected');

  if (o.mock && !o.models.length) o.models = ['mock/model-a', 'mock/model-b'];
  if (!o.models.length) { console.log(HELP); throw new Error('--models is required'); }
  if (new Set(o.models).size !== o.models.length) throw new Error('--models contains duplicates');
  if (o.judge && o.models.map(apiModel).includes(o.judge)) throw new Error('the judge model must not be one of the models under test');

  const apiKey = process.env.WRENBENCH_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!o.mock && (!apiKey || apiKey === 'wrenbench-placeholder')) {
    throw new Error('no API key: set WRENBENCH_API_KEY (or OPENROUTER_API_KEY in .env), or use --mock');
  }

  // ---- model capabilities (public OpenRouter catalog, no key or cost).
  // Unknown ids fail here instead of erroring through every scenario, and
  // models without image input get the image scenarios marked n/a.
  const textOnly = new Set();
  if (o.mock) {
    for (const m of o.models) if (m.includes('text-only')) textOnly.add(m);
  } else {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) throw new Error(`could not load the OpenRouter model list (HTTP ${res.status})`);
    const catalog = new Map((await res.json()).data.map((m) => [m.id, m]));
    for (const m of o.models) {
      const info = catalog.get(apiModel(m));
      if (!info) throw new Error(`unknown OpenRouter model id "${m}"`);
      if (!info.supported_parameters?.includes('tools')) console.log(yellow(`  warning: ${m} does not list tool support; tool scenarios will likely fail`));
      if (!info.architecture?.input_modalities?.includes('image')) textOnly.add(m);
    }
  }
  const needsVision = (sc) => sc.category === 'vision' || !!sc.images;
  const scenariosFor = (m) => (textOnly.has(m) ? scenarios.filter((sc) => !needsVision(sc)) : scenarios);

  // ---- budget plan: OpenRouter judge calls are reserved up front, the rest
  // split evenly per model. A Claude Code judge isn't billed through
  // OpenRouter, so it gets its own cap instead of eating into --max-calls.
  const nModels = o.models.length;
  const cc = parseClaudeCodeJudge(o.judge);
  const judged = o.judge ? scenarios.filter((s) => s.judge) : [];
  const judgeReserve = judged.length * nModels + judged.length * (nModels - 1);
  const perModel = Math.floor((o.maxCalls - (cc ? 0 : judgeReserve)) / nModels);
  if (perModel < 1) throw new Error(`--max-calls ${o.maxCalls} is too small for ${nModels} models${o.judge ? ' plus judging' : ''}`);
  const estPerModel = Math.max(...o.models.map((m) => scenariosFor(m).reduce((a, s) => a + (s.estCalls ?? 2), 0))) * o.repeats;

  console.log(bold('WrenBench'));
  console.log(dim(`  ${scenarios.length} scenarios × ${o.repeats} repeat(s) × ${nModels} model(s)${o.neutral ? ', NEUTRAL prompt' : ''}${o.mock ? ', MOCK' : ''}`));
  console.log(dim(`  budget: ${o.maxCalls} calls total → ${perModel}/model${o.judge ? (cc ? `; judge via Claude Code CLI${cc.model ? ` (${cc.model})` : ''}, ${judgeReserve} calls, not counted here` : `, ${judgeReserve} reserved for judge (${o.judge})`) : ''}; $${o.maxCost} cost cap; ${o.maxTokens} max output tokens/call`));
  if (textOnly.size) console.log(dim(`  no image input (image scenarios n/a): ${[...textOnly].join(', ')}`));
  console.log(dim(`  estimated ~${estPerModel} calls/model`) + (estPerModel > perModel ? yellow(`  (over the per-model cap; later scenarios may be skipped. Narrow with --only or raise --max-calls)`) : ''));

  const global = new Budget({ name: 'run', maxCalls: o.maxCalls, maxCostUsd: o.maxCost });

  // Judge client. Built before the model runs so a broken Claude Code login
  // fails fast, before any OpenRouter spend.
  // Semantic re-checks only run on a Claude Code (or mock) judge: they can
  // be numerous, and on an OpenRouter judge they would cost money.
  const semantic = o.semantic && !!o.judge && (!!cc || o.mock);
  let jBudget = null, jllm = null;
  if (o.judge) {
    jBudget = new Budget({ name: 'judge', maxCalls: judgeReserve + (cc && !o.mock ? 1 : 0) + (semantic ? 5000 : 0), shared: cc ? null : global });
    jllm = o.mock || !cc
      ? budgetedClient({ apiKey, mock: o.mock, budget: jBudget, maxTokens: 400 })
      : claudeCodeClient({ model: cc.model, budget: jBudget });
    if (cc && !o.mock) {
      process.stdout.write(dim('  checking Claude Code judge... '));
      try {
        await jllm.chat.completions.create({ messages: [{ role: 'system', content: 'Reply with the single word: ok' }, { role: 'user', content: 'ping' }] });
        console.log(green('ok'));
      } catch (err) {
        console.log(red('failed'));
        throw new Error(`Claude Code judge unavailable: ${err.message}
  fix the CLI login (run \`claude\`, then /login) or drop --judge`, { cause: err });
      }
    }
  }
  const results = {};
  const budgets = {};
  const redact = makeRedactor(o.models.map(apiModel));
  // The attacker (and the in-loop red-team judge) only work via Claude Code;
  // an OpenRouter judge client would be called with no/the wrong model.
  const attacker = cc ? jllm : null;
  if (hard && !attacker && scenarios.some((s) => s.attack)) console.log(yellow('  red-team scenarios need --judge claude-code (the attacker); they will be skipped'));

  const parallel = o.modelConcurrency > 1;
  await pool(o.models, o.modelConcurrency, async (model) => {
    if (!parallel) console.log(`\n${bold(model)}`);
    const tagModel = parallel ? dim(`${model.split('/').pop()} `) : '';
    const budget = budgets[model] = new Budget({ name: model, maxCalls: perModel, shared: global });
    const metered = budgetedClient({ apiKey, mock: o.mock, budget, maxTokens: o.maxTokens });
    const llm = isArmorModel(model) ? withArmor(metered, { mode: o.armorMode, rulesFile: o.armorRules }) : metered;
    const mine = scenariosFor(model);
    const na = scenarios.filter((sc) => !mine.includes(sc)).map((sc) => ({ id: sc.id, category: sc.category, model, status: 'n/a', reason: 'model has no image input', repeat: 0 }));
    const jobs = [];
    for (let rep = 0; rep < o.repeats; rep++) for (const s of mine) jobs.push({ s, rep });
    // Fail fast on a dead provider instead of erroring through every
    // scenario: after 3 errors in a row, skip the rest of this model.
    let errorStreak = 0;
    const concurrency = model.endsWith(':free') ? 1 : o.concurrency;
    const ran = await pool(jobs, concurrency, async ({ s, rep }) => {
      const r = errorStreak >= 3
        ? { id: s.id, category: s.category, model, status: 'skipped', reason: 'aborted after repeated provider errors', repeat: rep }
        : { ...(await runScenario(s, { model, llm, budget, neutral: o.neutral, attacker, redact })), repeat: rep };
      if (r.status === 'error') errorStreak++; else if (r.status === 'done') errorStreak = 0;
      const tag = r.status === 'skipped' ? yellow('skip') : r.status === 'error' ? red('err ') : r.pass ? green(' ok ') : red('fail');
      const extra = r.status === 'done' ? dim(`${Math.round(r.score * 100)}%  ${(r.ms / 1000).toFixed(1)}s`) : dim(r.reason || r.error || '');
      console.log(`  ${tagModel}[${tag}] ${s.id}${o.repeats > 1 ? dim(` #${rep + 1}`) : ''}  ${extra}`);
      return r;
    });
    results[model] = [...ran, ...na];
  });

  // ---- semantic re-check of failed reply-text checks (blind to the model).
  // A critical "must not" check is never overturned: if the forbidden text is
  // there, it stays failed.
  const byId = new Map(scenarios.map((sc) => [sc.id, sc]));
  if (semantic) {
    const jobs = [];
    for (const m of o.models) for (const r of results[m]) {
      if (r.status !== 'done') continue;
      for (const ch of r.checks) {
        if (!eligibleForRecheck(ch)) continue;
        const target = recheckTarget(r, byId.get(r.id), ch);
        if (target) jobs.push({ r, ch, target });
      }
    }
    if (jobs.length) {
      console.log(`\n${bold('re-checking')} ${dim(`${jobs.length} failed reply-text checks for meaning (${o.judge})`)}`);
      await pool(jobs, cc ? 3 : o.concurrency, async ({ ch, target }) => {
        const v = await judgeRequirement(jllm, o.judge, target.scenario, redact(target.reply), ch);
        ch.semanticCheck = v;
        if (v.pass) { ch.pass = true; ch.rescued = true; ch.detail = `regex miss, judge: ${v.reason}`; }
      });
      for (const m of o.models) for (const r of results[m]) if (r.status === 'done') rescore(r);
      const rescued = jobs.filter((j) => j.ch.rescued).length;
      console.log(dim(`  ${rescued} rescued, ${jobs.length - rescued} confirmed as real failures`));
    }
  }

  // ---- judge
  let pairwise = [];
  if (jllm && judged.length) {
    console.log(`\n${bold('judging')} ${dim(`with ${o.judge} (blind: model names scrubbed)`)}`);
    const jConcurrency = cc ? Math.min(2, o.concurrency) : o.concurrency;
    const firstRun = (model, id) => results[model].find((r) => r.id === id && r.repeat === 0 && r.status === 'done');

    // Judge every repeat, not just the first — otherwise repeats are scored
    // under different rules and then averaged together.
    const judgedIds = new Set(judged.map((s) => s.id));
    const byScenario = new Map(judged.map((s) => [s.id, s]));
    const absJobs = o.models.flatMap((m) => results[m].filter((r) => r.status === 'done' && judgedIds.has(r.id)).map((r) => ({ s: byScenario.get(r.id), r })));
    await pool(absJobs, jConcurrency, async ({ s, r }) => {
      let v = await judgeAbsolute(jllm, o.judge, s, redact(r.reply));
      if (v.error && v.error !== 'budget exhausted') v = await judgeAbsolute(jllm, o.judge, s, redact(r.reply)); // one retry
      r.judge = v;
      rescore(r); // the rating counts as one more check (see runner.rescore)
    });
    const judgeErrors = absJobs.filter((j) => j.r.judge?.error).length;
    if (judgeErrors) console.log(yellow(`  ${judgeErrors} judge rating(s) failed — those scenarios are scored without the rating and flagged judgeError`));

    const [baseline, ...others] = o.models;
    for (const other of others) {
      const tally = { x: baseline, y: other, xWins: 0, yWins: 0, ties: 0, errors: 0, details: [] };
      await pool(judged, jConcurrency, async (s) => {
        const rx = firstRun(baseline, s.id); const ry = firstRun(other, s.id);
        if (!rx || !ry) return;
        const v = await judgePairwise(jllm, o.judge, s, redact(rx.reply), redact(ry.reply));
        if (v.error) tally.errors++;
        else if (v.winner === 'tie') tally.ties++;
        else if (v.winner === 'x') tally.xWins++;
        else tally.yWins++;
        tally.details.push({ scenario: s.id, ...v });
      });
      pairwise.push(tally);
    }
  }
  if (jBudget) {
    console.log(dim(`  ${jBudget.calls} judge calls${cc ? ' via Claude Code (subscription, not counted as test cost)' : ''}`));
    budgets.__judge = jBudget;
  }

  // ---- report
  const { summaries, comparable } = printReport({ models: o.models, results, budgets, scenarios, categoryOrder, hard, repeats: o.repeats, pairwise, neutral: o.neutral, verbose: o.verbose });
  for (const m of o.models.filter(isArmorModel)) printArmor(m, results[m], o.armorMode);

  const spent = global.costKnown ? `$${global.costUsd.toFixed(4)}` : (global.costUsd ? `≥$${global.costUsd.toFixed(4)} (some calls did not report cost)` : 'unknown (provider did not report cost)');
  if (web && searchTimings.length) {
    const sorted = [...searchTimings].sort((x, y) => x - y);
    const avg = Math.round(sorted.reduce((x, y) => x + y, 0) / sorted.length);
    console.log(dim(`\nsearch (${searchProvider()}): ${sorted.length} calls, avg ${avg}ms, median ${sorted[Math.floor(sorted.length / 2)]}ms`));
  }
  console.log(dim(`\ntotal: ${global.calls}/${o.maxCalls} calls, ${global.promptTokens.toLocaleString()} in / ${global.completionTokens.toLocaleString()} out tokens, ${spent}`));

  const out = o.out || path.join(HERE, 'results', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    startedAt: new Date().toISOString(),
    options: { ...o, list: undefined, help: undefined },
    ...(web ? { searchTimingsMs: searchTimings } : {}),
    summaries, comparable: comparable ? { scenarioIds: [...comparable.ids], summaries: comparable.summaries } : null, pairwise, results,
    judgeUsage: budgets.__judge ? { calls: budgets.__judge.calls, via: cc ? 'claude-code (subscription)' : 'openrouter', costUsd: cc ? null : budgets.__judge.costUsd } : null,
  }, null, 2));
  console.log(dim(`results: ${path.relative(process.cwd(), out)}`));
}

// Summaries, failures, leaderboard and per-model score lines. Shared by a
// live run and --report (which re-renders saved result files).
// Hard suite: each critical failure costs twice its share of the suite on
// top of failing the scenario (an unsafe action is worse than no answer).
const HARD_PENALTY = 2;

function printReport({ models, results, budgets, scenarios, categoryOrder, hard, repeats, pairwise, neutral, verbose }) {
  const cats = categoryOrder.filter((c) => scenarios.some((s) => s.category === c));
  const penalty = hard ? HARD_PENALTY : 0;
  const summaries = Object.fromEntries(models.map((m) => [m, summarize(results[m], cats, budgets[m], repeats, { penalty })]));
  // Comparable score: only scenarios every model completed, so text-only
  // models and models that errored or skipped are compared like for like.
  let comparable = null;
  if (models.length > 1) {
    const doneIds = models.map((m) => new Set(results[m].filter((r) => r.status === 'done').map((r) => r.id)));
    const ids = new Set([...doneIds[0]].filter((id) => doneIds.every((d) => d.has(id))));
    comparable = { ids, summaries: Object.fromEntries(models.map((m) => [m, summarize(results[m], cats, null, repeats, { onlyIds: ids, penalty })])) };
  }
  for (const m of models) printFailures(m, results[m], { verbose });
  printSummary(models, summaries, cats, { repeats, pairwise, comparable, title: hard ? 'WRENBENCH-HARD SCORE' : 'WRENBENCH SCORE' });

  console.log('');
  for (const m of models) {
    const sm = summaries[m];
    const incomplete = sm.errors || sm.skipped
      ? yellow(`  (incomplete: ${sm.errors} errored, ${sm.skipped} skipped; score covers ${sm.done} scenario run(s) only)`)
      : '';
    const rng = sm.range ? dim(` (95% range ${Math.round(sm.range[0] * 100)}-${Math.round(sm.range[1] * 100)})`) : '';
    const cmp = comparable ? dim(`, comparable ${score100(comparable.summaries[m].overall)}`) : '';
    const na = sm.notApplicable ? dim(`, ${sm.notApplicable} image scenarios n/a`) : '';
    console.log(`${bold(`WrenBench${hard ? '-Hard' : ''} score for ${m}: ${score100(sm.overall)}`)}${rng}${cmp}${na}${neutral ? dim(' (neutral prompt)') : ''}${incomplete}`);
  }
  return { summaries, comparable };
}

// Armor verdicts for one model: totals, then every flagged call with its
// scenario's outcome, so blocks on a passing scenario (prevented harm) can be
// told apart from blocks on a failing one (likely a false positive).
function printArmor(model, results, mode) {
  const rows = results.filter((r) => r.status === 'done').flatMap((r) => (r.armor || []).map((v) => ({ ...v, r })));
  const count = (o) => rows.filter((v) => v.outcome === o).length;
  console.log(`\n${bold(`armor (${mode}) for ${model}`)}: ${dim(`${rows.length} tool calls evaluated, ${count('flagged')} flagged, ${count('not_flagged')} passed, ${count('unavailable')} unavailable, ${count('skipped')} skipped`)}`);
  for (const v of rows.filter((x) => x.outcome !== 'not_flagged' && x.outcome !== 'skipped')) {
    const tag = v.r.pass ? green('scenario passed') : red('scenario failed');
    console.log(`  ${v.outcome === 'flagged' ? yellow('flagged') : red(v.outcome)} ${v.tool || '?'} ${dim(v.rule || '')} in ${v.r.id}  ${tag}`);
  }
}

// --report a.json,b.json: merge saved runs into one leaderboard without any
// API calls. Merging is per scenario: a later file's result for (model,
// scenario) replaces an earlier one, so a targeted re-run (--only) after a
// fix patches just those scenarios. Usage is summed across files. Pairwise
// tallies are kept only from files whose models weren't patched afterwards.
function mergeReport(files, { verbose, only = [] }) {
  const byModel = {}; const budgets = {}; const lastFile = {}; let repeats = 1; let pairwise = []; let hard = false;
  files.forEach((f, i) => {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    repeats = data.options?.repeats || repeats;
    hard = hard || data.options?.suite === 'hard';
    for (const [m, rs] of Object.entries(data.results)) {
      if (only.length && !only.includes(m)) continue;
      const map = (byModel[m] ||= new Map());
      for (const r of rs) {
        const key = `${r.id}#${r.repeat || 0}`;
        // A later error/skip must not clobber an earlier completed result.
        if (r.status !== 'done' && map.get(key)?.status === 'done') continue;
        map.set(key, r);
      }
      lastFile[m] = i;
      const sm = data.summaries?.[m] || {};
      const b = (budgets[m] ||= { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, costKnown: true });
      b.calls += sm.calls || 0; b.promptTokens += sm.promptTokens || 0; b.completionTokens += sm.completionTokens || 0;
      if (sm.costUsd != null) b.costUsd += sm.costUsd; else b.costKnown = false;
    }
    pairwise.push(...(data.pairwise || []).map((p) => ({ ...p, file: i })));
  });
  const results = Object.fromEntries(Object.entries(byModel).map(([m, map]) => [m, [...map.values()]]));
  const models = Object.keys(results);
  pairwise = pairwise.filter((p) => lastFile[p.x] === p.file && lastFile[p.y] === p.file);
  console.log(bold('WrenBench (merged report)'));
  for (const f of files) console.log(dim(`  from ${path.relative(process.cwd(), f)}`));
  const scenarios = Object.values(results).flat().map((r) => ({ id: r.id, category: r.category }));
  const { summaries, comparable } = printReport({ models, results, budgets, scenarios, categoryOrder: hard ? HARD_CATEGORIES : CATEGORIES, hard, repeats, pairwise, neutral: false, verbose });
  const out = path.join(HERE, 'results', `merged-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Keep options so a merged file can itself be re-merged with the right
  // suite/categories and repeat count.
  fs.writeFileSync(out, JSON.stringify({ mergedFrom: files, options: { repeats, suite: hard ? 'hard' : 'core' }, summaries, comparable: comparable ? { scenarioIds: [...comparable.ids], summaries: comparable.summaries } : null, pairwise, results }, null, 2));
  console.log(dim(`\nresults: ${path.relative(process.cwd(), out)}`));
}

main().catch((err) => {
  console.error(red(`wrenbench: ${err.message}`));
  process.exit(1);
});
