#!/usr/bin/env node
// Armor comparison charts: the same model with no Armor, the first rule set
// (deny by action type) and the second (deny by intent). Same brand styling
// as charts.js.
//
//   node bench/armorCharts.js [--out bench/charts]
//
// Runs are listed in CONFIGS below; a config without a hard file shows
// "not run" instead of a bar.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const OUT = args.out || path.join(HERE, 'charts');
const R = (f) => path.join(HERE, 'results', f);

const CONFIGS = [
  { key: 'none', name: 'No Armor', sub: 'gpt-6-luna, Wren\'s own guards only', model: 'openai/gpt-6-luna', core: R('final-core.json'), hard: R('final-hard.json') },
  { key: 'v1', name: 'Armor v1', sub: 'deny by action type (soft_deny)', model: 'openai/gpt-6-luna+armor', core: R('armor-luna-core.json'), hard: null },
  { key: 'v2', name: 'Armor v2', sub: 'deny by intent (hard_deny)', model: 'openai/gpt-6-luna+armor', core: R('armor2-luna-core.json'), hard: R('armor2-luna-hard.json') },
];

// ---------- tokens (kept in step with charts.js) ----------
const C = {
  surface: '#F1F1F1', ink: '#1C1C1C', ink2: '#5C5C58', muted: '#8A8A85',
  grid: '#DCDCD6', axis: '#C3C2B7', wren: '#1F3E12', band: '#E9E9E5',
  core: '#75B15F', hard: '#1F3E12',
  good: '#0CA30C', critical: '#D03B3B',
};
const DISPLAY = "'IBM Plex Sans JP', sans-serif";
const BODY = "'Lexend', sans-serif";
const W = 1200;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const text = (x, y, s, { size = 16, font = BODY, weight = 400, fill = C.ink, anchor = 'start', ls = 0, extra = '' } = {}) =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls ? ` letter-spacing="${ls}"` : ''} ${extra}>${esc(s)}</text>`;
const hbar = (x, y, w, h, fill) => {
  if (w <= 0) return '';
  const r = Math.min(4, w);
  return `<path d="M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z" fill="${fill}"/>`;
};
function frame(h, { eyebrow, title, subtitle, foot }, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">
  <rect width="100%" height="100%" fill="${C.surface}"/>
  ${text(64, 76, eyebrow.toUpperCase(), { size: 14, weight: 500, fill: C.wren, ls: '0.08em' })}
  ${text(64, 126, title, { size: 42, font: DISPLAY, weight: 700, ls: '-0.025em' })}
  ${subtitle.map((s, i) => text(64, 164 + i * 26, s, { size: 18, fill: C.ink2, weight: 300 })).join('')}
  ${body}
  ${foot.filter(Boolean).map((f, i, a) => text(64, h - 36 - (a.length - 1 - i) * 22, f, { size: 13, fill: C.ink2, weight: 300 })).join('')}
</svg>`;
}
function icon(kind, cx, cy) {
  if (kind === 'pass') return `<circle cx="${cx}" cy="${cy}" r="11" fill="${C.good}"/><path d="M${cx - 5},${cy} l3.5,3.5 l6.5,-7" stroke="#FFFFFF" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (kind === 'fail') return `<circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="${C.muted}" stroke-width="2"/><path d="M${cx - 4},${cy - 4} l8,8 M${cx + 4},${cy - 4} l-8,8" stroke="${C.muted}" stroke-width="2" stroke-linecap="round"/>`;
  if (kind === 'unsafe') return `<path d="M${cx},${cy - 12} L${cx + 12},${cy + 9} L${cx - 12},${cy + 9} Z" fill="${C.critical}" stroke-linejoin="round"/><path d="M${cx},${cy - 4} v6" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"/><circle cx="${cx}" cy="${cy + 6}" r="1.4" fill="#FFFFFF"/>`;
  return `<path d="M${cx - 8},${cy} h16" stroke="${C.axis}" stroke-width="2" stroke-linecap="round"/>`;
}
// Small shield: "Armor blocked a call here".
const shield = (cx, cy, fill = C.wren) => `<path d="M${cx},${cy - 9} L${cx + 7},${cy - 6} V${cy} Q${cx + 7},${cy + 6} ${cx},${cy + 9} Q${cx - 7},${cy + 6} ${cx - 7},${cy} V${cy - 6} Z" fill="${fill}"/>`;

// ---------- data ----------
const load = (f) => (f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
for (const c of CONFIGS) {
  for (const suite of ['core', 'hard']) {
    const d = load(c[suite]);
    c[suite] = d ? { summary: d.summaries[c.model], results: (d.results[c.model] || []).filter((r) => (r.repeat || 0) === 0) } : null;
  }
}
const pct = (v) => Math.round(v * 100);

// A flag is a false block when it cost the scenario: the scenario failed
// and either a failed check names the blocked tool, or the same scenario
// passed without Armor. Blocked calls aren't in toolCalls (Armor removed
// them), so this works from outcomes rather than the call's arguments. A
// block the model routed around, or one inside a sweep the scenario forbids
// (mass-postal blocks the sweep, then the single kick asked next goes
// through), counts as harmless.
function flags(results, suite) {
  const base = new Map((CONFIGS[0][suite]?.results || []).map((r) => [r.id, r]));
  const out = [];
  for (const r of results || []) {
    for (const v of r.armor || []) {
      if (v.outcome !== 'flagged') continue;
      const named = (r.checks || []).some((ch) => !ch.pass && ch.label?.includes(v.tool));
      const falseBlock = !r.pass && (named || !!base.get(r.id)?.pass);
      out.push({ id: r.id, tool: v.tool, rule: (v.rule || '').replace(/[[\]]/g, ''), falseBlock, scenarioPass: r.pass });
    }
  }
  return out;
}

// ---------- A: scores by config ----------
function scores() {
  const top = 262; const rowH = 116; const labelW = 300; const x0 = 64 + labelW; const plotW = 560;
  const H = top + CONFIGS.length * rowH + 110;
  const sx = (v) => x0 + (v / 100) * plotW;
  let body = '';
  body += `<rect x="64" y="207" width="14" height="14" rx="3" fill="${C.core}"/>${text(86, 219, 'Core (142 scenarios)', { size: 15 })}`;
  body += `<rect x="264" y="207" width="14" height="14" rx="3" fill="${C.hard}"/>${text(286, 219, 'Hard (55 adversarial)', { size: 15 })}`;
  body += `<path d="M470,214 h28 M470,208 v12 M498,208 v12" stroke="${C.ink2}" stroke-width="1.5"/>${text(508, 219, '95% range (resampled scenarios)', { size: 15 })}`;
  for (const t of [0, 25, 50, 75, 100]) {
    body += `<line x1="${sx(t)}" y1="${top - 20}" x2="${sx(t)}" y2="${top + CONFIGS.length * rowH - 30}" stroke="${t ? C.grid : C.axis}" stroke-width="1"/>`;
    body += text(sx(t), top + CONFIGS.length * rowH - 8, t, { size: 13, fill: C.muted, anchor: 'middle' });
  }
  const colX = [x0 + plotW + 120, x0 + plotW + 216];
  body += text(colX[0], top - 30, 'Overall', { size: 13, fill: C.ink2, anchor: 'middle', weight: 500 });
  body += text(colX[1], top - 30, 's / scenario', { size: 13, fill: C.ink2, anchor: 'middle', weight: 500 });
  body += text(colX[1], top - 14, 'core · hard', { size: 12, fill: C.muted, anchor: 'middle' });
  CONFIGS.forEach((c, i) => {
    const y = top + i * rowH;
    if (c.key === 'v2') body += `<rect x="56" y="${y - 22}" width="${W - 112}" height="${rowH - 14}" rx="8" fill="${C.band}"/>`;
    body += text(64, y + 8, c.name, { size: 21, weight: 500 });
    body += text(64, y + 32, c.sub, { size: 14, fill: C.ink2, weight: 300 });
    [['core', C.core, 0], ['hard', C.hard, 36]].forEach(([suite, fill, dy]) => {
      const s = c[suite]?.summary; const by = y - 14 + dy;
      if (!s) { body += text(x0 + 8, by + 18, 'not run', { size: 15, fill: C.muted, weight: 300 }); return; }
      body += hbar(x0, by, sx(pct(s.overall)) - x0, 26, fill);
      if (s.range) {
        const [lo, hi] = s.range.map((v) => sx(v * 100)); const my = by + 13;
        body += `<path d="M${lo},${my} H${hi} M${lo},${my - 6} v12 M${hi},${my - 6} v12" stroke="${C.ink2}" stroke-width="1.5"/>`;
      }
      const labelX = Math.max(sx(pct(s.overall)), s.range ? sx(s.range[1] * 100) : 0) + 12;
      body += text(labelX, by + 20, pct(s.overall), { size: suite === 'hard' ? 22 : 18, font: DISPLAY, weight: 700, fill: suite === 'hard' ? C.ink : C.ink2 });
    });
    const overall = c.core?.summary && c.hard?.summary ? Math.round(Math.sqrt(pct(c.core.summary.overall) * pct(c.hard.summary.overall))) : null;
    body += text(colX[0], y + 24, overall ?? '–', { size: 26, font: DISPLAY, weight: 700, anchor: 'middle', fill: overall ? C.ink : C.muted });
    const lat = ['core', 'hard'].map((s) => (c[s]?.summary ? (c[s].summary.latencyMs / 1000).toFixed(1) : '–')).join(' · ');
    body += text(colX[1], y + 22, lat, { size: 16, fill: C.ink2, anchor: 'middle' });
  });
  const [n, v2] = [CONFIGS[0], CONFIGS[2]];
  return frame(H, {
    eyebrow: 'WrenBench · Armor, by config',
    title: 'Same score, different failures',
    subtitle: [
      `Armor v2 moves gpt-6-luna from ${pct(n.core.summary.overall)} to ${pct(v2.core.summary.overall)} on Core and ${pct(n.hard.summary.overall)} to ${pct(v2.hard.summary.overall)} on Hard, well inside`,
      'the noise of a single run. What changes is which scenarios fail, shown on the next charts.',
    ],
    foot: [
      'One run per config (pass^1). Overall = √(Core × Hard). Core here is each run\'s own score, not the multi-model comparable score.',
      'Armor v1 was only run on Core: its false blocks on Core were reason enough to rewrite the rules.',
    ],
  }, body);
}

// ---------- B: what Armor blocked ----------
function blocked() {
  const runs = CONFIGS.flatMap((c) => ['core', 'hard'].filter((s) => c[s] && c.key !== 'none').map((s) => ({ c, suite: s, data: c[s] })));
  const top = 270; const rowH = 112; const labelW = 300; const x0 = 64 + labelW; const plotW = 500;
  const H = top + runs.length * rowH + 100;
  const maxN = Math.max(...runs.map((r) => flags(r.data.results, r.suite).length));
  const scale = plotW / Math.max(1, Math.ceil(maxN / 5) * 5);
  let body = '';
  body += `<rect x="64" y="207" width="14" height="14" rx="3" fill="${C.wren}"/>${text(86, 219, 'Stopped a forbidden call, or cost nothing', { size: 15 })}`;
  body += `<rect x="420" y="207" width="14" height="14" rx="3" fill="${C.critical}"/>${text(442, 219, 'False block: cost the scenario', { size: 15 })}`;
  const colX = [x0 + plotW + 110, x0 + plotW + 210];
  body += text(colX[0], top - 30, 'calls checked', { size: 13, fill: C.ink2, anchor: 'middle', weight: 500 });
  body += text(colX[1], top - 30, 'scenarios', { size: 13, fill: C.ink2, anchor: 'middle', weight: 500 });
  body += text(colX[1], top - 14, 'fixed · broken', { size: 12, fill: C.muted, anchor: 'middle' });
  runs.forEach(({ c, suite, data }, i) => {
    const y = top + i * rowH;
    const f = flags(data.results, suite); const good = f.filter((x) => !x.falseBlock); const bad = f.filter((x) => x.falseBlock);
    body += text(64, y + 8, `${c.name} · ${suite === 'core' ? 'Core' : 'Hard'}`, { size: 21, weight: 500 });
    body += text(64, y + 32, c.sub, { size: 14, fill: C.ink2, weight: 300 });
    body += hbar(x0, y - 12, good.length * scale, 30, C.wren);
    if (bad.length) body += `<rect x="${x0 + good.length * scale + 2}" y="${y - 12}" width="${Math.max(3, bad.length * scale - 2)}" height="30" rx="3" fill="${C.critical}"/>`;
    body += text(x0 + f.length * scale + 12, y + 10, `${good.length} + ${bad.length}`, { size: 20, font: DISPLAY, weight: 700 });
    // the scenarios behind the bars
    const where = [...new Set(bad.map((x) => x.id.split('/').pop()))];
    body += text(x0, y + 42, bad.length ? `false blocks in ${where.join(', ')}` : 'no false blocks', { size: 13, fill: bad.length ? C.critical : C.ink2, weight: 400 });
    const checked = data.results.reduce((a, r) => a + (r.armor?.length || 0), 0);
    body += text(colX[0], y + 10, checked, { size: 18, fill: C.ink2, anchor: 'middle' });
    // scenario-level effect vs. no Armor on the same suite
    const base = new Map((CONFIGS[0][suite]?.results || []).map((r) => [r.id, r]));
    const flaggedIds = new Set(f.map((x) => x.id));
    const fixed = data.results.filter((r) => flaggedIds.has(r.id) && r.pass && base.get(r.id) && !base.get(r.id).pass && f.some((x) => x.id === r.id && !x.falseBlock)).length;
    const broken = data.results.filter((r) => flaggedIds.has(r.id) && !r.pass && base.get(r.id)?.pass).length;
    body += text(colX[1] - 12, y + 10, `+${fixed}`, { size: 20, font: DISPLAY, weight: 700, fill: C.good, anchor: 'end' });
    body += text(colX[1], y + 10, '·', { size: 18, fill: C.muted, anchor: 'middle' });
    body += text(colX[1] + 12, y + 10, `−${broken}`, { size: 20, font: DISPLAY, weight: 700, fill: broken ? C.critical : C.muted });
  });
  return frame(H, {
    eyebrow: 'WrenBench · what Armor blocked',
    title: 'v1 blocked real work. v2 blocks the sweep.',
    subtitle: [
      'Every flagged tool call, split by whether the block cost the scenario. v1 stopped PMs and kicks',
      'users asked for. v2 almost only stops mass kicks, the one thing gpt-6-luna kept doing on its own.',
    ],
    foot: [
      'Fixed / broken: scenarios whose result flipped against the no-Armor run and where Armor flagged a call.',
      'False block: the scenario failed with Armor, and a failed check names the blocked tool or it passed without Armor.',
    ],
  }, body);
}

// ---------- C: scenarios that changed ----------
function changed() {
  const rows = [];
  for (const suite of ['core', 'hard']) {
    const ids = new Set(CONFIGS.flatMap((c) => (c[suite]?.results || []).map((r) => r.id)));
    for (const id of ids) {
      const res = CONFIGS.map((c) => c[suite]?.results.find((r) => r.id === id) || null);
      const passes = res.filter((r) => r?.status === 'done').map((r) => r.pass);
      if (new Set(passes).size < 2) continue;
      const f = CONFIGS.map((c) => flags(c[suite]?.results.filter((r) => r.id === id), suite));
      const any = f.flat();
      const j = f.map((x) => x.length > 0).lastIndexOf(true);
      const latest = j >= 0 ? f[j] : [];
      const cfg = j >= 0 ? CONFIGS[j].name.replace('Armor ', '') : '';
      const cause = !any.length ? 'reply text only; Armor not involved'
        : latest.every((x) => x.falseBlock) ? `${cfg} false block: ${latest[0].tool} (${latest[0].rule})`
          : `${cfg} blocked ${latest[0].tool} (${latest[0].rule})`;
      rows.push({ suite, id, res, f, cause, armor: any.length > 0 });
    }
  }
  rows.sort((a, b) => (a.suite === b.suite ? Number(b.armor) - Number(a.armor) : a.suite === 'core' ? -1 : 1));
  const top = 300; const rowH = 44; const labelW = 330; const x0 = 64 + labelW; const colW = 120;
  const causeX = x0 + CONFIGS.length * colW + 24;
  const H = top + rows.length * rowH + 40 + 100;
  let body = '';
  [['pass', 'Passed'], ['fail', 'Failed'], ['unsafe', 'Unsafe (critical)'], ['na', 'Not run']].forEach(([k, l], i) => {
    const x = 64 + [0, 120, 230, 420][i];
    body += icon(k, x + 11, 214) + text(x + 30, 219, l, { size: 15 });
  });
  body += shield(620, 214) + text(636, 219, 'Armor flagged a call in this run', { size: 15 });
  CONFIGS.forEach((c, j) => {
    body += text(x0 + j * colW + colW / 2, top - 40, c.name, { size: 15, weight: 500, anchor: 'middle' });
  });
  body += text(causeX, top - 40, 'What changed it', { size: 15, weight: 500 });
  let y = top; let lastSuite = null;
  for (const r of rows) {
    if (r.suite !== lastSuite) {
      body += text(64, y + 4, r.suite === 'core' ? 'CORE' : 'HARD', { size: 12, weight: 500, fill: C.wren, ls: '0.08em' });
      y += 26; lastSuite = r.suite;
    }
    if (r.armor) body += `<rect x="56" y="${y - 21}" width="${W - 112}" height="${rowH - 2}" rx="6" fill="${C.band}"/>`;
    body += text(64, y + 6, r.id.replace(/^hard\//, ''), { size: 15 });
    r.res.forEach((res, j) => {
      const cx = x0 + j * colW + colW / 2;
      const kind = !res || res.status !== 'done' ? 'na' : res.criticalFail ? 'unsafe' : res.pass ? 'pass' : 'fail';
      body += icon(kind, cx, y);
      if (r.f[j].length) body += shield(cx + 24, y, r.f[j].every((x) => x.falseBlock) ? C.critical : C.wren);
    });
    body += text(causeX, y + 5, r.cause, { size: 14, fill: r.armor ? C.ink : C.ink2, weight: r.armor ? 400 : 300 });
    y += rowH;
  }
  return frame(H, {
    eyebrow: 'WrenBench · scenario by scenario',
    title: 'Where Armor changed the result',
    subtitle: [
      'Every scenario whose outcome differs between configs. Armor fixed the mass-kick tests on both',
      'suites. Most other flips are reply wording or red-team variance that Armor never sees.',
    ],
    foot: [
      'Red shield: a false block that cost the scenario. Green shield: Armor stopped a forbidden call, or the block cost nothing.',
      'Armor only judges tool calls, so failures in reply text (persona, research wording, red-team claims) are outside its reach.',
    ],
  }, body);
}

// ---------- render ----------
fs.mkdirSync(OUT, { recursive: true });
const charts = [['armor-01-scores', scores()], ['armor-02-blocked', blocked()], ['armor-03-changed', changed()]];
for (const [name, svg] of charts) await sharp(Buffer.from(svg), { density: 144 }).png().toFile(path.join(OUT, `${name}.png`));
console.log(`charts: ${path.relative(process.cwd(), OUT)}/ (${charts.map((c) => c[0]).join(', ')})`);
