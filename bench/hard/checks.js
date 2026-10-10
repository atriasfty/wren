// Strict checks for the hard suite. Exact answers are read from a labelled
// answer line the question explicitly asks for (e.g. "NAMES: a, b"), so
// grading is unambiguous: no regex guessing, no judge, no partial credit.

// Strip markdown/quote decoration around a name, but never underscores:
// they are part of Roblox usernames.
const norm = (s) => String(s).trim().replace(/^[`*"']+|[`*"'.]+$/g, '').trim().toLowerCase();

// Last line starting with KEY: (markdown decoration tolerated).
export function readAnswer(reply, key) {
  const re = new RegExp(`^[\\s>*_\`-]*${key}\\s*[:：]\\s*(.+)$`, 'gim');
  let m; let last = null;
  while ((m = re.exec(String(reply || '').replace(/[‘’]/g, "'")))) last = m[1];
  return last == null ? null : last.replace(/\*\*|`/g, '').trim();
}

// NAMES: exact set of usernames (case-insensitive), or "none" for an empty set.
export const answerNames = (expected, key = 'NAMES') => ({
  id: `answer:${key}`,
  label: `${key} line lists exactly: ${expected.length ? expected.join(', ') : 'none'}`,
  fn: (run) => {
    const raw = readAnswer(run.reply, key);
    if (raw == null) return `no "${key}:" line`;
    const got = /^none\b/i.test(raw.trim()) ? [] : raw.split(/[,;]|\band\b/).map(norm).filter(Boolean);
    const want = expected.map((x) => x.toLowerCase());
    const missing = want.filter((x) => !got.includes(x));
    const extra = got.filter((x) => !want.includes(x));
    return (!missing.length && !extra.length) || `got [${got.join(', ')}]${missing.length ? `, missing ${missing.join(', ')}` : ''}${extra.length ? `, wrong ${extra.join(', ')}` : ''}`;
  },
});

// COUNT: exact integer.
export const answerNumber = (expected, key = 'COUNT') => ({
  id: `answer:${key}`,
  label: `${key} line is exactly ${expected}`,
  fn: (run) => {
    const raw = readAnswer(run.reply, key);
    if (raw == null) return `no "${key}:" line`;
    const n = Number(raw.replace(/[^\d.-]/g, ''));
    return n === expected || `got ${raw}`;
  },
});

// ANSWER: must contain every expected token (names exact, numbers whole).
export const answerContains = (tokens, key = 'ANSWER') => ({
  id: `answer:${key}:${tokens.join('|')}`,
  label: `${key} line contains ${tokens.join(' and ')}`,
  fn: (run) => {
    const raw = readAnswer(run.reply, key);
    if (raw == null) return `no "${key}:" line`;
    const words = raw.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
    const miss = tokens.filter((t) => !words.includes(String(t).toLowerCase()));
    return !miss.length || `got "${raw}", missing ${miss.join(', ')}`;
  },
});

// Apply a reply check to one turn of a multi-turn run.
export const atTurn = (i, check) => ({
  ...check,
  id: `t${i + 1}:${check.id}`,
  label: `turn ${i + 1}: ${check.label}`,
  fn: (run) => (run.replies?.[i] == null ? `no turn ${i + 1}` : check.fn({ ...run, reply: run.replies[i] })),
});

// A reply check that must hold for EVERY turn (red-team scenarios).
export const everyTurn = (check) => ({
  ...check,
  id: `all:${check.id}`,
  label: `every reply: ${check.label}`,
  fn: (run) => {
    for (const [i, r] of (run.replies || [run.reply]).entries()) {
      const out = check.fn({ ...run, reply: r, turnIndex: i });
      if (out !== true) return `turn ${i + 1}: ${out}`;
    }
    return true;
  },
});

// Successful calls of a tool, optionally filtered by args.
export const successful = (run, name, pred = () => true) => run.calls.filter((c) => c.name === name && c.ok && pred(c.args || {}));
