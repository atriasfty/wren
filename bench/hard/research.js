// Research tasks: long, specific questions over a full 40-player server whose
// answers need many lookups combined. Answers are computed from the tool dump
// (see dump.js), and each task looks for a seed where its answer is non-trivial
// (e.g. 2-5 names, a unique maximum).
import { generateWorld, STAFF_PERMS } from './worldgen.js';
import { dumpViaTools, minutes } from './dump.js';
import { answerNames, answerNumber, readAnswer } from './checks.js';
import { maxSteps, critical, noSuccessfulWrites } from '../checks.js';

const MOD = { kind: 'discord', rank: 'mod', name: 'modsam' };
const LIVERY_TEAM = { 'LCPD Marked': 'Police', 'Sheriff Marked': 'Sheriff', 'LCFD Command': 'Fire', 'DOT Utility': 'DOT' };
const NAMES_FMT = 'End your reply with one line in exactly this format: `NAMES: name1, name2` (or `NAMES: none`).';
const COUNT_FMT = 'End your reply with one line in exactly this format: `COUNT: <number>`.';
const ANSWER_FMT = (shape) => `End your reply with one line in exactly this format: \`ANSWER: ${shape}\`.`;

const pun = (d, u) => d.players[u]?.punishments || [];
const info = (d, u) => d.players[u]?.info;
const uniq = (xs) => [...new Set(xs)];
const topUnique = (counts) => {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length && (entries.length === 1 || entries[0][1] > entries[1][1]) ? { name: entries[0][0], count: entries[0][1] } : null;
};

// ANSWER: <one username>, <number> with no other online username on the line.
const answerOne = (name, count, allNames) => ({
  id: 'answer:ANSWER',
  label: `ANSWER line is exactly ${name}, ${count}`,
  fn: (run) => {
    const raw = readAnswer(run.reply, 'ANSWER');
    if (raw == null) return 'no "ANSWER:" line';
    const words = raw.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
    const named = allNames.filter((n) => words.includes(n.toLowerCase()));
    if (named.length !== 1 || named[0].toLowerCase() !== name.toLowerCase()) return `got "${raw}"`;
    return words.includes(String(count)) || `got "${raw}" (count should be ${count})`;
  },
});

const TASKS = [
  {
    key: 'wanted-with-ban',
    solve: (d) => d.wanted.filter((w) => pun(d, w.username).some((p) => p.type === 'Ban')).map((w) => w.username),
    accept: (a) => a.length >= 2 && a.length <= 5,
    variants: [
      `Which players who are wanted right now have at least one prior Ban on their record? ${NAMES_FMT}`,
      `go through everyone with wanted stars and tell me which of them have been banned before (at least one Ban in their history). ${NAMES_FMT}`,
      `I need the subset of currently wanted players whose punishment history includes a Ban. ${NAMES_FMT}`,
    ],
    check: (a) => answerNames(a),
    format: (a) => `NAMES: ${a.join(', ') || 'none'}`,
  },
  {
    key: 'livery-mismatch',
    solve: (d) => uniq(d.vehicles.filter((v) => LIVERY_TEAM[v.Texture] && info(d, v.Owner) && info(d, v.Owner).team !== LIVERY_TEAM[v.Texture]).map((v) => v.Owner)),
    accept: (a) => a.length >= 1 && a.length <= 4,
    question: `Which players are driving a vehicle with an emergency livery (LCPD, Sheriff, LCFD or DOT) that doesn't belong to their own team? ${NAMES_FMT}`,
    check: (a) => answerNames(a),
    format: (a) => `NAMES: ${a.join(', ') || 'none'}`,
  },
  {
    key: 'top-killer-30',
    solve: (d) => {
      const c = {};
      for (const [u, p] of Object.entries(d.players)) for (const k of p.activity?.kills || []) if (minutes(k.at) <= 30) c[u] = (c[u] || 0) + 1;
      return topUnique(c);
    },
    accept: (a) => a && a.count >= 2,
    question: `Who has the most kills in the last 30 minutes (a kill 30 minutes ago counts), and how many? Count kills, not victims. ${ANSWER_FMT('<username>, <kills>')}`,
    check: (a, d) => answerOne(a.name, a.count, d.online),
    format: (a) => `ANSWER: ${a.name}, ${a.count}`,
  },
  {
    key: 'staff-kicked-own-team',
    solve: (d) => {
      const staff = new Set(d.online.filter((u) => STAFF_PERMS.includes(info(d, u)?.permission)));
      const out = [];
      for (const l of d.commands) {
        const m = l.command.match(/^:kick (\S+)/);
        if (!m || minutes(l.at) > 120 || !staff.has(l.player)) continue;
        if (info(d, m[1]) && info(d, m[1]).team === info(d, l.player).team) out.push(l.player);
      }
      return uniq(out);
    },
    accept: (a) => a.length >= 1 && a.length <= 3,
    question: `Audit the command logs: which staff members used :kick on a player from their OWN team in the last 2 hours (120 minutes ago or less)? Compare the staff member's team with the kicked player's team. ${NAMES_FMT}`,
    check: (a) => answerNames(a),
    format: (a) => `NAMES: ${a.join(', ') || 'none'}`,
  },
  {
    key: 'modcall-subject-punishments',
    solve: (d) => uniq(d.briefing.modcalls.map((m) => m.about)).reduce((n, u) => n + pun(d, u).length, 0),
    accept: (a) => a >= 3,
    question: `Take every distinct player that a current modcall is about (the reported player, not the caller). What's the total number of prior punishments across all of them combined? ${COUNT_FMT}`,
    check: (a) => answerNumber(a),
    format: (a) => `COUNT: ${a}`,
  },
  {
    key: 'young-wanted',
    solve: (d) => d.wanted.filter((w) => (d.players[w.username]?.roblox?.accountAgeDays ?? 1e9) < 14).map((w) => w.username),
    accept: (a) => a.length >= 1 && a.length <= 4,
    variants: [
      `Which wanted players have Roblox accounts younger than 14 days? ${NAMES_FMT}`,
      `alt check: anyone with wanted stars whose roblox account is under two weeks old (less than 14 days)? ${NAMES_FMT}`,
      `List the currently wanted players with an account age below 14 days. ${NAMES_FMT}`,
    ],
    check: (a) => answerNames(a),
    format: (a) => `NAMES: ${a.join(', ') || 'none'}`,
  },
  {
    key: 'street-of-latest-911',
    solve: (d) => {
      const street = d.briefing.emergencyCalls[0]?.street;
      return d.online.filter((u) => d.players[u]?.profile?.street === street);
    },
    accept: (a) => a.length >= 2 && a.length <= 6,
    question: `Look at the most recent 911 call. Which online players are on the same street as that call right now? ${NAMES_FMT}`,
    check: (a) => answerNames(a),
    format: (a) => `NAMES: ${a.join(', ') || 'none'}`,
  },
  {
    key: 'staff-most-commands-60',
    solve: (d) => {
      const c = {};
      for (const l of d.commands) if (minutes(l.at) <= 60) c[l.player] = (c[l.player] || 0) + 1;
      return topUnique(c);
    },
    accept: (a) => a && a.count >= 3,
    question: `Which staff member has run the most commands in the last hour (60 minutes ago or less), and how many commands? ${ANSWER_FMT('<username>, <commands>')}`,
    check: (a, d) => answerOne(a.name, a.count, d.online),
    format: (a) => `ANSWER: ${a.name}, ${a.count}`,
  },
  {
    key: 'wanted-stars-postal-300s',
    solve: (d) => d.wanted.filter((w) => { const p = Number(d.players[w.username]?.profile?.postal); return p >= 300 && p <= 399; }).reduce((n, w) => n + w.stars, 0),
    accept: (a, d) => a >= 3 && d.wanted.filter((w) => { const p = Number(d.players[w.username]?.profile?.postal); return p >= 300 && p <= 399; }).length >= 2,
    variants: [
      `What's the total number of wanted stars among wanted players located in postals 300 to 399? ${COUNT_FMT}`,
      `add up the wanted stars of everyone wanted who's currently in a 300-range postal (300-399). ${COUNT_FMT}`,
      `Sum the wanted levels of all wanted players whose current postal code is between 300 and 399 inclusive. ${COUNT_FMT}`,
    ],
    check: (a) => answerNumber(a),
    format: (a) => `COUNT: ${a}`,
  },
  {
    key: 'twin-compare',
    solve: (d, w) => {
      const [a, b] = w.meta.twins[0];
      const age = (u) => d.players[u]?.roblox?.accountAgeDays;
      return { a, b, older: age(a) > age(b) ? a : b, pa: pun(d, a).length, pb: pun(d, b).length };
    },
    accept: (a) => a && a.pa !== a.pb,
    question: (a) => `Compare ${a.a} and ${a.b}. Careful: these are two DIFFERENT players with nearly identical names. Which one has the older Roblox account, and how many prior punishments does each have? ${ANSWER_FMT(`<older username>, <punishments of ${a.a}>, <punishments of ${a.b}>`)}`,
    check: (a) => ({
      id: 'answer:twins', label: `ANSWER is ${a.older}, ${a.pa}, ${a.pb}`,
      fn: (run) => {
        const raw = readAnswer(run.reply, 'ANSWER');
        if (raw == null) return 'no "ANSWER:" line';
        const parts = raw.split(',').map((x) => x.trim().replace(/^[`*_"']+|[`*_"'.]+$/g, ''));
        const ok = parts.length >= 3 && parts[0].toLowerCase() === a.older.toLowerCase() && Number(parts[1]) === a.pa && Number(parts[2]) === a.pb;
        return ok || `got "${raw}"`;
      },
    }),
    format: (a) => `ANSWER: ${a.older}, ${a.pa}, ${a.pb}`,
  },
  {
    key: 'vehicles-of-kicked',
    solve: (d) => d.vehicles.filter((v) => pun(d, v.Owner).some((p) => p.type === 'Kick')).length,
    accept: (a) => a >= 2,
    question: `How many currently spawned vehicles belong to players who have at least one prior Kick in their punishment history? ${COUNT_FMT}`,
    check: (a) => answerNumber(a),
    format: (a) => `COUNT: ${a}`,
  },
  {
    key: 'modcaller-deaths',
    solve: (d) => uniq(d.briefing.modcalls.map((m) => m.caller)).reduce((n, u) => n + (d.players[u]?.activity?.deaths?.length || 0), 0),
    accept: (a) => a >= 2,
    question: `For every distinct player who filed a current modcall (the caller), how many times have they died this session? Give the total across all of them. ${COUNT_FMT}`,
    check: (a) => answerNumber(a),
    format: (a) => `COUNT: ${a}`,
  },
];

// Find the first seed (from base) whose dump gives an acceptable answer.
async function pickSeed(task, base) {
  for (let seed = base; seed < base + 400; seed++) {
    const world = generateWorld(seed);
    const dump = await dumpViaTools(world);
    const answer = task.solve(dump, world);
    if (task.accept(answer, dump)) return { seed, dump, answer };
  }
  throw new Error(`no seed found for research/${task.key}`);
}

export async function buildResearch(baseSeed) {
  const out = [];
  for (const [i, task] of TASKS.entries()) {
    const { seed, dump, answer } = await pickSeed(task, baseSeed + i * 1000);
    const q = typeof task.question === 'function' ? task.question(answer) : task.question;
    out.push({
      id: `hard/research/${task.key}`, category: 'research', binary: true, actor: MOD, estCalls: 4 * (task.variants?.length || 1),
      description: `seed ${seed}`,
      makeWorld: () => generateWorld(seed),
      maxSteps: 8,
      ...(task.variants ? { variants: task.variants } : { question: q }),
      checks: [task.check(answer, dump), maxSteps(6), critical(noSuccessfulWrites(null, 'takes no actions on a research question'))],
      oracle: { type: 'dump', solve: (d) => task.solve(d, generateWorld(seed)), format: task.format },
      answer,
    });
  }
  return out;
}
