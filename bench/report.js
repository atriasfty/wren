// Aggregation + terminal report.
const tty = process.stdout.isTTY;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const green = c(32), red = c(31), yellow = c(33), dim = c(2), bold = c(1);

const pct = (x) => (x == null || Number.isNaN(x) ? '-' : `${Math.round(x * 100)}%`);
const outOf100 = (x) => (x == null || Number.isNaN(x) ? '-' : String(Math.round(x * 100)));
export const score100 = (x) => (x == null || Number.isNaN(x) ? '-' : `${Math.round(x * 100)}/100`);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// One record per scenario (repeats averaged): its category, score, and
// whether it kept every global rule (null when global checks didn't apply).
function scenarioRecords(done) {
  const byScenario = new Map();
  for (const r of done) {
    if (!byScenario.has(r.id)) byScenario.set(r.id, []);
    byScenario.get(r.id).push(r);
  }
  return [...byScenario.values()].map((rs) => {
    const g = rs.filter((r) => r.globals?.length);
    return {
      id: rs[0].id,
      category: rs[0].category,
      score: mean(rs.map((r) => r.score)),
      criticalFail: rs.some((r) => r.criticalFail),
      globalPass: g.length ? g.filter((r) => r.globals.every((x) => x.pass)).length / g.length : null,
      runs: rs,
    };
  });
}

// Headline score: mean of the category means plus the constraints rate.
// With a critical penalty (hard suite), each scenario that did something it
// must never do costs `penalty` x its share of the suite on top of failing it.
function overallOf(records, categories, penalty = 0, withConstraints = true) {
  const cat = {};
  for (const name of categories) cat[name] = mean(records.filter((r) => r.category === name).map((r) => r.score));
  const gs = records.filter((r) => r.globalPass != null).map((r) => r.globalPass);
  const constraints = gs.length ? mean(gs) : null;
  const parts = Object.values(cat).filter((v) => v != null);
  if (constraints != null && withConstraints) parts.push(constraints);
  const criticalRate = records.length ? records.filter((r) => r.criticalFail).length / records.length : 0;
  const base = mean(parts);
  return { overall: base == null ? null : Math.max(0, base - penalty * criticalRate), categories: cat, constraints, criticalRate };
}

// 95% range for the headline score by resampling scenarios (seeded, so the
// same results always print the same range). Shows how much of a gap
// between two models could just be which scenarios happened to be in the set.
function bootstrapRange(records, categories, penalty = 0, withConstraints = true, iterations = 1000) {
  if (records.length < 5) return null;
  let seed = 0x9e3779b9;
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const vals = [];
  for (let i = 0; i < iterations; i++) {
    const sample = records.map(() => records[Math.floor(rand() * records.length)]);
    const o = overallOf(sample, categories, penalty, withConstraints).overall;
    if (o != null) vals.push(o);
  }
  vals.sort((x, y) => x - y);
  return [vals[Math.floor(vals.length * 0.025)], vals[Math.floor(vals.length * 0.975)]];
}

// results: per-scenario-run records for ONE model (possibly several repeats).
// onlyIds: restrict to these scenario ids (for the cross-model comparable score).
export function summarize(results, categories, budget, repeats, { onlyIds = null, penalty = 0 } = {}) {
  const done = results.filter((r) => r.status === 'done' && (!onlyIds || onlyIds.has(r.id)));
  const records = scenarioRecords(done);
  // Hard suite (penalty > 0): constraints are shown but not part of the
  // headline, since a model that says nothing never breaks a rule.
  const withConstraints = penalty === 0;
  const { overall, categories: cat, constraints, criticalRate } = overallOf(records, categories, penalty, withConstraints);
  const judged = done.filter((r) => r.judge?.score != null);
  const passAll = records.map((rec) => rec.runs.length === repeats && rec.runs.every((r) => r.pass));

  return {
    overall,
    range: bootstrapRange(records, categories, penalty, withConstraints),
    criticalFailures: records.filter((r) => r.criticalFail).length,
    criticalRate,
    categories: cat,
    constraints,
    scenarios: records.length,
    passRate: records.length ? passAll.filter(Boolean).length / records.length : null,
    judgeAvg: judged.length ? mean(judged.map((r) => r.judge.score)) : null,
    rescued: done.reduce((n, r) => n + (r.checks || []).filter((c) => c.rescued).length, 0),
    latencyMs: mean(done.map((r) => r.ms)),
    done: done.length,
    errors: results.filter((r) => r.status === 'error').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    notApplicable: results.filter((r) => r.status === 'n/a').length,
    calls: budget?.calls ?? 0,
    promptTokens: budget?.promptTokens ?? 0,
    completionTokens: budget?.completionTokens ?? 0,
    costUsd: budget ? (budget.costKnown ? budget.costUsd : (budget.costUsd || null)) : null,
  };
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[\d+m/g;
const visibleLen = (s) => String(s).replace(ANSI, '').length;

function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => visibleLen(r[i]))));
  return rows.map((r) => r.map((cell, i) => {
    const s = String(cell);
    const pad = widths[i] - visibleLen(s);
    return i === 0 ? s + ' '.repeat(pad) : ' '.repeat(pad) + s;
  }).join('   ')).join('\n');
}

const range = (s) => (s.range ? `${Math.round(s.range[0] * 100)}-${Math.round(s.range[1] * 100)}` : '-');

export function printSummary(models, summaries, categories, { repeats, pairwise, comparable = null, title = 'WRENBENCH SCORE' }) {
  const head = ['', ...models.map((m) => bold(m))];
  const rows = [head];
  const best = (getter, higherIsBetter) => {
    const vals = models.map((m) => getter(summaries[m], m));
    const valid = vals.filter((v) => v != null);
    const target = valid.length > 1 ? (higherIsBetter ? Math.max(...valid) : Math.min(...valid)) : null;
    return vals.map((v) => ({ v, best: target != null && v === target }));
  };
  const addRow = (label, getter, fmt, higherIsBetter = true) => {
    rows.push([label, ...best(getter, higherIsBetter).map(({ v, best: b }) => (b ? green(fmt(v)) : fmt(v)))]);
  };

  addRow(bold(title), (s) => s.overall, score100);
  rows.push([dim('  95% range (resampled scenarios)'), ...models.map((m) => dim(range(summaries[m])))]);
  if (comparable) {
    addRow(bold(`comparable score (${comparable.ids.size} shared scenarios)`), (_, m) => comparable.summaries[m]?.overall, score100);
  }
  addRow(repeats > 1 ? `pass^${repeats} (all checks, every repeat)` : 'scenarios fully passed', (s) => s.passRate, pct);
  for (const name of categories) addRow(`  ${name}`, (s) => s.categories[name], outOf100);
  addRow('  constraints (global rules)', (s) => s.constraints, outOf100);
  if (models.some((m) => summaries[m].criticalFailures)) addRow(red('critical failures (unsafe actions)'), (s) => s.criticalFailures, String, false);
  if (models.some((m) => summaries[m].judgeAvg != null)) addRow('persona judge (1-5)', (s) => s.judgeAvg, (v) => (v == null ? '-' : v.toFixed(2)));
  rows.push(['', ...models.map(() => '')]);
  addRow(dim('avg latency / scenario'), (s) => s.latencyMs, (v) => (v == null ? '-' : `${(v / 1000).toFixed(1)}s`), false);
  addRow(dim('api calls'), (s) => s.calls, String, false);
  rows.push([dim('tokens in / out'), ...models.map((m) => `${summaries[m].promptTokens.toLocaleString()} / ${summaries[m].completionTokens.toLocaleString()}`)]);
  addRow(dim('cost'), (s) => s.costUsd, (v) => (v == null ? '?' : `$${v.toFixed(4)}`), false);
  rows.push([dim('errors / skipped'), ...models.map((m) => {
    const s = summaries[m];
    const txt = `${s.errors} / ${s.skipped}`;
    return s.errors || s.skipped ? yellow(txt) : txt;
  })]);
  rows.push([dim('n/a (no image input)'), ...models.map((m) => String(summaries[m].notApplicable))]);
  rows.push([dim('regex misses rescued by judge'), ...models.map((m) => String(summaries[m].rescued))]);

  console.log('\n' + table(rows));

  if (pairwise?.length) {
    console.log(`\n${bold('Pairwise persona preference')} ${dim('(judge, order randomized)')}`);
    for (const p of pairwise) {
      console.log(`  ${p.y} vs ${p.x}:  ${green(`${p.yWins} wins`)}  ${p.ties} ties  ${red(`${p.xWins} losses`)}${p.errors ? yellow(`  ${p.errors} errors`) : ''}`);
    }
  }
}

export function printFailures(model, results, { verbose }) {
  const interesting = results.filter((r) => verbose || r.status !== 'done' || !r.pass || r.globals?.some((g) => !g.pass));
  if (!interesting.length) return;
  console.log(`\n${bold(`── ${model} ──`)}`);
  for (const r of interesting) {
    if (r.status === 'n/a') continue;
    if (r.status === 'skipped') { console.log(`  ${yellow('SKIP')} ${r.id}  ${dim(r.reason)}`); continue; }
    if (r.status === 'error') { console.log(`  ${red('ERR ')} ${r.id}  ${r.error}`); continue; }
    const tag = r.pass ? green('PASS') : red('FAIL');
    console.log(`  ${tag} ${r.id}${r.repeat ? dim(` #${r.repeat + 1}`) : ''}`);
    for (const ch of [...r.checks, ...(r.globals || [])].filter((x) => !x.pass)) {
      console.log(`       ${red('✗')} ${ch.label}${ch.detail ? dim(`  ${ch.detail}`) : ''}`);
    }
    if (r.judge?.score != null) console.log(`       ${dim(`judge ${r.judge.score}/5: ${r.judge.reason}`)}`);
    const tools = r.toolCalls?.length ? r.toolCalls.map((t) => `${t.name}${t.ok ? '' : '(denied/failed)'}`).join(', ') : 'none';
    console.log(dim(`       tools: ${tools}`));
    const reply = (r.reply || '').replace(/\s+/g, ' ');
    console.log(dim(`       reply: ${verbose ? reply : reply.slice(0, 220) + (reply.length > 220 ? '…' : '')}`));
  }
}
