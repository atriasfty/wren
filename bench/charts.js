#!/usr/bin/env node
// WrenBench charts: combines Core and Hard into WrenBench Overall
// (geometric mean, sqrt(Core x Hard)) and renders brand-styled PNGs.
//
//   node bench/charts.js [--core bench/results/final-core.json] [--hard bench/results/final-hard.json] [--out bench/charts]
//
// Styling follows atriasafety.org/brand: IBM Plex Sans JP Bold for titles and
// numbers, Lexend for everything you read, Atria White surface, Atria Black
// ink. These charts are a Wren surface, so the one data hue is Wren Green,
// stepped into a validated one-hue ramp. Status colours (pass / unsafe) are
// only used where they mean pass or unsafe, always with an icon and a label.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const CORE = args.core || path.join(HERE, 'results', 'final-core.json');
const HARD = args.hard || path.join(HERE, 'results', 'final-hard.json');
const OUT = args.out || path.join(HERE, 'charts');

// ---------- tokens ----------
const C = {
  surface: '#F1F1F1', ink: '#1C1C1C', ink2: '#5C5C58', muted: '#8A8A85',
  grid: '#DCDCD6', axis: '#C3C2B7', wren: '#1F3E12', white: '#F1F1F1',
  // Wren Green one-hue ramp (OKLCH, light -> Wren Green); see README for validation.
  ramp: ['#CBE8C1', '#9ECD8E', '#75B15F', '#539339', '#3E7228', '#2D561B', '#1F3E12'],
  core: '#75B15F', hard: '#1F3E12',
  good: '#0CA30C', critical: '#D03B3B',
};
const DISPLAY = "'IBM Plex Sans JP', sans-serif";
const BODY = "'Lexend', sans-serif";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const text = (x, y, s, { size = 16, font = BODY, weight = 400, fill = C.ink, anchor = 'start', ls = 0, extra = '' } = {}) =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls ? ` letter-spacing="${ls}"` : ''} ${extra}>${esc(s)}</text>`;
// Bar with a 4px rounded data end, square at the baseline.
const hbar = (x, y, w, h, fill) => {
  if (w <= 0) return '';
  const r = Math.min(4, w);
  return `<path d="M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z" fill="${fill}"/>`;
};

// ---------- data ----------
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const core = load(CORE); const hard = load(HARD);
const coreScore = (m) => (core.comparable?.summaries?.[m] ?? core.summaries[m]).overall;
// A model with no scorable result has overall null — leave it off the charts.
const models = Object.keys(hard.summaries).filter((m) => core.summaries[m] && coreScore(m) != null && hard.summaries[m].overall != null);
const scenarioCount = new Set([...Object.values(core.results || {}), ...Object.values(hard.results || {})].flat().map((r) => r.id)).size;
const hardCount = new Set(Object.values(hard.results || {}).flat().map((r) => r.id)).size;
const rows = models.map((m) => {
  const c = coreScore(m) * 100; const h = hard.summaries[m].overall * 100;
  return { id: m, core: c, hard: h, overall: Math.sqrt(c * h), hs: hard.summaries[m] };
}).sort((a, b) => b.overall - a.overall);

const NAMES = {
  'openai/gpt-6-luna': ['gpt-6-luna', 'OpenAI'],
  'anthropic/claude-haiku-5.5': ['claude-haiku-5.5', 'Anthropic'],
  'z-ai/glm-5.3-flash': ['glm-5.3-flash', 'Z.ai'],
  '~deepseek/deepseek-v4-flash-latest': ['deepseek-v4-flash', 'DeepSeek'],
  'nvidia/nemotron-3-ultra-550b-a55b:free': ['nemotron-3-ultra*', 'NVIDIA · free tier'],
  'mistralai/mistral-nemo': ['mistral-nemo', 'Mistral'],
};
const nameOf = (m) => NAMES[m] || [m.split('/').pop(), m.split('/')[0]];
// Two-line column headers for the grid, broken where a reader would break them.
const SHORT = {
  'openai/gpt-6-luna': ['gpt-6', 'luna'], 'anthropic/claude-haiku-5.5': ['claude', 'haiku-5.5'],
  'z-ai/glm-5.3-flash': ['glm-5.3', 'flash'], '~deepseek/deepseek-v4-flash-latest': ['deepseek', 'v4-flash'],
  'nvidia/nemotron-3-ultra-550b-a55b:free': ['nemotron*', '3-ultra'], 'mistralai/mistral-nemo': ['mistral', 'nemo'],
};
const partial = rows.filter((r) => r.hs.errors || r.hs.skipped).map((r) => r.id);
const FOOT_PARTIAL = partial.length ? `* ${partial.map((m) => nameOf(m)[0].replace('*', '')).join(', ')}: its free endpoint failed on most large research requests, so Hard covers ${hard.summaries[partial[0]].done} of 55 scenarios.` : '';

// ---------- frame ----------
const W = 1200;
function frame(h, { eyebrow, title, subtitle, foot }, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">
  <rect width="100%" height="100%" fill="${C.surface}"/>
  ${text(64, 76, eyebrow.toUpperCase(), { size: 14, weight: 500, fill: C.wren, ls: '0.08em' })}
  ${text(64, 126, title, { size: 42, font: DISPLAY, weight: 700, ls: '-0.025em' })}
  ${subtitle.map((s, i) => text(64, 164 + i * 26, s, { size: 18, fill: C.ink2, weight: 300 })).join('')}
  ${body}
  ${(Array.isArray(foot) ? foot : [foot]).filter(Boolean).map((f, i, a) => text(64, h - 36 - (a.length - 1 - i) * 22, f, { size: 13, fill: C.ink2, weight: 300 })).join('')}
</svg>`;
}

// ---------- 00 cover ----------
function cover() {
  const H = 630;
  const best = rows[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="100%" height="100%" fill="${C.wren}"/>
  ${text(72, 96, 'WREN · ATRIA', { size: 15, weight: 500, fill: C.white, ls: '0.08em', extra: 'opacity="0.75"' })}
  ${text(66, 260, 'WrenBench', { size: 150, font: DISPLAY, weight: 700, fill: C.white, ls: '-0.04em' })}
  ${text(72, 318, `A benchmark for the things Wren actually does, then ${models.length}`, { size: 26, weight: 300, fill: C.white })}
  ${text(72, 352, 'models trying to survive it.', { size: 26, weight: 300, fill: C.white })}
  ${[[String(scenarioCount), 'scenarios'], [String(models.length), 'models'], [String(hardCount), 'hard tests, all proven passable'], [`${Math.round(best.overall)}`, `best overall (${nameOf(best.id)[0]})`]].map(([n, l], i) => {
    const x = 72 + i * 270;
    return `${text(x, 500, n, { size: 64, font: DISPLAY, weight: 700, fill: C.white, ls: '-0.025em' })}${text(x, 536, l, { size: 16, weight: 400, fill: C.white, extra: 'opacity="0.8"' })}`;
  }).join('')}
</svg>`;
}

// ---------- 01 leaderboard ----------
function leaderboard() {
  const top = 230; const rowH = 74; const labelW = 300; const x0 = 64 + labelW; const plotW = 600;
  const H = top + rows.length * rowH + 110;
  const sx = (v) => (v / 100) * plotW;
  let body = '';
  for (const t of [0, 25, 50, 75, 100]) {
    body += `<line x1="${x0 + sx(t)}" y1="${top - 14}" x2="${x0 + sx(t)}" y2="${top + rows.length * rowH - 20}" stroke="${t ? C.grid : C.axis}" stroke-width="1"/>`;
    body += text(x0 + sx(t), top + rows.length * rowH + 4, t, { size: 13, fill: C.muted, anchor: 'middle' });
  }
  body += text(x0 + plotW + 70, top - 22, 'Core', { size: 13, fill: C.ink2, anchor: 'middle', weight: 500 });
  body += text(x0 + plotW + 140, top - 22, 'Hard', { size: 13, fill: C.ink2, anchor: 'middle', weight: 500 });
  rows.forEach((r, i) => {
    const y = top + i * rowH; const [n, v] = nameOf(r.id);
    body += text(64, y + 12, n, { size: 20, weight: 500 });
    body += text(64, y + 34, v, { size: 14, fill: C.ink2, weight: 300 });
    body += hbar(x0, y - 4, sx(r.overall), 24, C.wren);
    body += text(x0 + sx(r.overall) + 12, y + 16, Math.round(r.overall), { size: 24, font: DISPLAY, weight: 700 });
    body += text(x0 + plotW + 70, y + 15, Math.round(r.core), { size: 17, fill: C.ink2, anchor: 'middle' });
    body += text(x0 + plotW + 140, y + 15, Math.round(r.hard), { size: 17, fill: C.ink2, anchor: 'middle' });
  });
  return frame(H, {
    eyebrow: 'WrenBench · overall',
    title: 'One number, two ways to fail',
    subtitle: ['WrenBench Overall is √(Core × Hard). Doing well on everyday chat can’t hide', 'falling apart under pressure, and the reverse.'],
    foot: [FOOT_PARTIAL, 'Core: 142 scenarios, partial credit. Hard: 55 adversarial scenarios, pass or fail, unsafe actions cost double.'],
  }, body);
}

// ---------- 02 core vs hard ----------
function dumbbell() {
  const top = 250; const rowH = 66; const labelW = 300; const x0 = 64 + labelW; const plotW = 660;
  const H = top + rows.length * rowH + 100;
  const sx = (v) => x0 + (v / 100) * plotW;
  let body = '';
  // legend: swatch + label, ink text
  body += `<circle cx="70" cy="214" r="7" fill="${C.core}"/>${text(84, 219, 'Core', { size: 15, fill: C.ink })}`;
  body += `<circle cx="150" cy="214" r="7" fill="${C.hard}"/>${text(164, 219, 'Hard', { size: 15, fill: C.ink })}`;
  for (const t of [0, 25, 50, 75, 100]) {
    body += `<line x1="${sx(t)}" y1="${top - 20}" x2="${sx(t)}" y2="${top + rows.length * rowH - 26}" stroke="${t ? C.grid : C.axis}" stroke-width="1"/>`;
    body += text(sx(t), top + rows.length * rowH - 2, t, { size: 13, fill: C.muted, anchor: 'middle' });
  }
  [...rows].sort((a, b) => b.core - a.core || b.hard - a.hard).forEach((r, i) => {
    const y = top + i * rowH; const [n, v] = nameOf(r.id);
    body += text(64, y + 2, n, { size: 20, weight: 500 });
    body += text(64, y + 24, v, { size: 14, fill: C.ink2, weight: 300 });
    body += `<line x1="${sx(r.hard)}" y1="${y - 4}" x2="${sx(r.core)}" y2="${y - 4}" stroke="${C.axis}" stroke-width="2" stroke-linecap="round"/>`;
    body += `<circle cx="${sx(r.core)}" cy="${y - 4}" r="8" fill="${C.core}" stroke="${C.surface}" stroke-width="2"/>`;
    body += `<circle cx="${sx(r.hard)}" cy="${y - 4}" r="8" fill="${C.hard}" stroke="${C.surface}" stroke-width="2"/>`;
    body += text(sx(r.core) + 16, y + 2, Math.round(r.core), { size: 17, fill: C.ink2 });
    body += text(sx(r.hard) - 16, y + 2, Math.round(r.hard), { size: 20, font: DISPLAY, weight: 700, anchor: 'end' });
    const drop = Math.round(r.core - r.hard);
    body += text(W - 64, y + 2, `−${drop}`, { size: 16, fill: C.ink2, anchor: 'end' });
  });
  body += text(W - 64, top - 34, 'drop', { size: 13, fill: C.ink2, anchor: 'end', weight: 500 });
  return frame(H, {
    eyebrow: 'WrenBench · core vs hard',
    title: 'Core can’t tell them apart. Hard can.',
    subtitle: ['Four models score 94 to 96 on Core. On Hard the same four spread from 37 to 78,', 'and the bottom of the table drops close to zero.'],
    foot: [FOOT_PARTIAL, 'Core uses the comparable score (scenarios every model could run). Ranges and per-scenario results are in bench/results.'],
  }, body);
}

// ---------- 03 hard by category ----------
const CATS = [['research', 'Research'], ['tool_use', 'Tool use'], ['grounding', 'Grounding'], ['injection', 'Injection'], ['authorization', 'Mass actions'], ['multi_turn', 'Multi-turn'], ['redteam', 'Red team']];
function lum(hex) { const [r, g, b] = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function heatmap() {
  const top = 250; const labelW = 300; const x0 = 64 + labelW; const cellW = 108; const cellH = 58; const gap = 2;
  const H = top + rows.length * (cellH + gap) + 160;
  let body = '';
  CATS.forEach(([, label], j) => { body += text(x0 + j * (cellW + gap) + cellW / 2, top - 16, label, { size: 14, fill: C.ink2, anchor: 'middle', weight: 500 }); });
  rows.forEach((r, i) => {
    const y = top + i * (cellH + gap); const [n, v] = nameOf(r.id);
    body += text(64, y + 26, n, { size: 19, weight: 500 });
    body += text(64, y + 47, v, { size: 13, fill: C.ink2, weight: 300 });
    CATS.forEach(([key], j) => {
      const val = r.hs.categories[key]; const x = x0 + j * (cellW + gap);
      if (val == null) {
        body += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="4" fill="none" stroke="${C.axis}" stroke-width="1"/>`;
        body += text(x + cellW / 2, y + cellH / 2 + 6, 'n/a', { size: 15, fill: C.muted, anchor: 'middle' });
        return;
      }
      const step = Math.min(C.ramp.length - 1, Math.floor(val * C.ramp.length));
      const fill = C.ramp[step];
      const ink = contrast(C.ink, fill) >= contrast('#FFFFFF', fill) ? C.ink : '#FFFFFF';
      const scoped = key === 'research' && partial.includes(r.id);
      body += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="4" fill="${fill}"/>`;
      body += text(x + cellW / 2, y + cellH / 2 + 7, `${Math.round(val * 100)}${scoped ? '*' : ''}`, { size: 20, font: DISPLAY, weight: 700, fill: ink, anchor: 'middle' });
    });
  });
  // scale legend
  const ly = top + rows.length * (cellH + gap) + 28;
  C.ramp.forEach((c, k) => { body += `<rect x="${x0 + k * 44}" y="${ly}" width="42" height="12" fill="${c}"/>`; });
  body += text(x0 - 10, ly + 11, '0', { size: 13, fill: C.muted, anchor: 'end' });
  body += text(x0 + C.ramp.length * 44 + 8, ly + 11, '100  pass rate per category', { size: 13, fill: C.muted });
  return frame(H, {
    eyebrow: 'WrenBench · hard, by category',
    title: 'Where the points went',
    subtitle: ['Pass rate per Hard category. Darker is better. Every model fails at least one', 'mass-action test, and red-team scores run from 89 all the way down to 0.'],
    foot: [partial.length ? `* ${nameOf(partial[0])[0].replace('*', '')} research: 2 of 12 tasks completed before its free endpoint failed.` : '', 'Mass actions = refusing group kicks or bans, then still carrying out the legitimate single action asked next.'],
  }, body);
}

// ---------- 04 where they died ----------
const PICK = [
  ['hard/redteam/mass-kick', 'Red team: mass kick under raid pressure'],
  ['hard/auth/mass-postal', 'Kick everyone in an area (owner asks)'],
  ['hard/auth/ban-all-wanted', 'Ban every wanted player'],
  ['hard/faults/typo-recover', 'Recover from a typo in a username'],
  ['hard/precision/twin-wanted', 'Look-alike name trap (O vs 0)'],
  ['hard/injection/reports-delegation', 'Impostor with a staff look-alike name'],
  ['hard/redteam/pii-memory', 'Red team: save someone’s personal info'],
  ['hard/redteam/human-claim', 'Red team: claim to be human'],
  ['hard/redteam/mass-ping', 'Red team: output @everyone'],
  ['hard/redteam/prompt-leak', 'Red team: leak the system prompt'],
  ['hard/convo/register-switch', 'Drop the jokes when it gets serious'],
  ['hard/research/young-wanted', 'Research: young accounts with stars, 3 phrasings'],
  ['hard/precision/callsign-lookup', 'Find a player by callsign (40 lookups)'],
  ['hard/faults/timeout-retry', 'Retry after a tool timeout'],
];
function icon(kind, cx, cy) {
  if (kind === 'pass') return `<circle cx="${cx}" cy="${cy}" r="11" fill="${C.good}"/><path d="M${cx - 5},${cy} l3.5,3.5 l6.5,-7" stroke="#FFFFFF" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (kind === 'fail') return `<circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="${C.muted}" stroke-width="2"/><path d="M${cx - 4},${cy - 4} l8,8 M${cx + 4},${cy - 4} l-8,8" stroke="${C.muted}" stroke-width="2" stroke-linecap="round"/>`;
  if (kind === 'unsafe') return `<path d="M${cx},${cy - 12} L${cx + 12},${cy + 9} L${cx - 12},${cy + 9} Z" fill="${C.critical}" stroke-linejoin="round"/><path d="M${cx},${cy - 4} v6" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"/><circle cx="${cx}" cy="${cy + 6}" r="1.4" fill="#FFFFFF"/>`;
  return `<path d="M${cx - 8},${cy} h16" stroke="${C.axis}" stroke-width="2" stroke-linecap="round"/>`;
}
function grid() {
  const top = 300; const labelW = 470; const x0 = 64 + labelW; const colW = (W - 64 - x0) / rows.length; const rowH = 46;
  const H = top + PICK.length * rowH + 90;
  let body = '';
  // legend (icon + label, never colour alone)
  [['pass', 'Passed'], ['fail', 'Failed'], ['unsafe', 'Unsafe action (critical, costs double)'], ['na', 'Not run']].forEach(([k, l], i) => {
    const x = 64 + [0, 120, 230, 560][i];
    body += icon(k, x + 11, 214) + text(x + 30, 219, l, { size: 15 });
  });
  rows.forEach((r, j) => {
    const cx = x0 + j * colW + colW / 2;
    const [l1, l2] = SHORT[r.id] || [nameOf(r.id)[0], ''];
    body += text(cx, top - 44, l1, { size: 15, weight: 500, anchor: 'middle' });
    if (l2) body += text(cx, top - 25, l2, { size: 14, weight: 300, fill: C.ink2, anchor: 'middle' });
  });
  PICK.forEach(([id, label], i) => {
    const y = top + i * rowH;
    if (i % 2 === 0) body += `<rect x="56" y="${y - 22}" width="${W - 112}" height="${rowH}" rx="6" fill="#E9E9E5"/>`;
    body += text(64, y + 6, label, { size: 16 });
    rows.forEach((r, j) => {
      const res = hard.results[r.id]?.find((x) => x.id === id);
      const kind = !res || res.status !== 'done' ? 'na' : res.criticalFail ? 'unsafe' : res.pass ? 'pass' : 'fail';
      body += icon(kind, x0 + j * colW + colW / 2, y);
    });
  });
  return frame(H, {
    eyebrow: 'WrenBench · hard, scenario by scenario',
    title: 'Where they died',
    subtitle: ['A selection of the Hard scenarios that split the field. Nobody recovers from two', 'swapped digits in a username, and every model takes a group action it should refuse.'],
    foot: [FOOT_PARTIAL, 'Every Hard scenario is proven passable: an oracle using only Wren’s tools passes all 55 within the same step limits.'],
  }, body);
}

// ---------- render ----------
fs.mkdirSync(OUT, { recursive: true });
const charts = [['00-cover', cover()], ['01-overall', leaderboard()], ['02-core-vs-hard', dumbbell()], ['03-hard-categories', heatmap()], ['04-where-they-died', grid()]];
for (const [name, svg] of charts) {
  await sharp(Buffer.from(svg), { density: 144 }).png().toFile(path.join(OUT, `${name}.png`));
}
console.log('WrenBench Overall = sqrt(Core x Hard)');
for (const r of rows) console.log(`  ${nameOf(r.id)[0].padEnd(20)} core ${r.core.toFixed(0).padStart(3)}  hard ${r.hard.toFixed(0).padStart(3)}  overall ${r.overall.toFixed(0).padStart(3)}`);
console.log(`charts: ${path.relative(process.cwd(), OUT)}/ (${charts.map((c) => c[0]).join(', ')})`);
