// LLM judge for the subjective persona scenarios. Optional (--judge <model>),
// and always a separate model from the contestants. Two modes:
//   absolute: 1-5 rubric score per model reply
//   pairwise: A/B preference between the first model and each other model,
//             with order randomized to cancel position bias
import { BudgetExceeded } from './llm.js';

const PERSONA = `Wren is a Discord bot for an ERLC (Roblox roleplay) community. Its intended voice: a fast, informal, slightly sarcastic friend who is great at server admin. Lowercase and playful in casual chat, with real opinions, light teasing, and no sycophancy or customer-service filler. It switches to a calm, warm, properly capitalized register for serious or sensitive topics and never jokes then. It never uses em dashes.`;

function context(scenario) {
  return `USER MESSAGE TO WREN:\n${scenario.question}${scenario.channelContext ? `\n\nRECENT CHANNEL MESSAGES:\n${scenario.channelContext}` : ''}`;
}

async function askJson(llm, model, system, user) {
  const resp = await llm.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    max_tokens: 400,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  const raw = resp.choices?.[0]?.message?.content || '';
  return JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
}

export async function judgeAbsolute(llm, judgeModel, scenario, reply) {
  try {
    const out = await askJson(llm, judgeModel,
      `You grade replies from a chatbot against a rubric.\n\n${PERSONA}\n\nRespond with ONLY JSON: {"score": 1-5, "reason": "<one sentence>"}. 5 = exactly what the rubric asks for, 3 = acceptable but generic, 1 = clearly wrong for the moment.`,
      `${context(scenario)}\n\nRUBRIC:\n${scenario.judge}\n\nWREN'S REPLY:\n${reply}`);
    const score = Math.max(1, Math.min(5, Number(out.score)));
    if (!Number.isFinite(score)) throw new Error('non-numeric score');
    return { score, reason: String(out.reason || '').slice(0, 300) };
  } catch (err) {
    return { error: err instanceof BudgetExceeded ? 'budget exhausted' : err.message };
  }
}

export async function judgePairwise(llm, judgeModel, scenario, replyX, replyY) {
  const flip = Math.random() < 0.5;
  const [a, b] = flip ? [replyY, replyX] : [replyX, replyY];
  try {
    const out = await askJson(llm, judgeModel,
      `You compare two candidate replies from a chatbot and pick the one that better fits the rubric and persona.\n\n${PERSONA}\n\nRespond with ONLY JSON: {"winner": "A" | "B" | "tie", "reason": "<one sentence>"}.`,
      `${context(scenario)}\n\nRUBRIC:\n${scenario.judge}\n\nREPLY A:\n${a}\n\nREPLY B:\n${b}`);
    const w = String(out.winner || '').toUpperCase();
    if (!['A', 'B', 'TIE'].includes(w)) throw new Error(`bad winner "${out.winner}"`);
    const winner = w === 'TIE' ? 'tie' : ((w === 'A') !== flip ? 'x' : 'y');
    return { winner, reason: String(out.reason || '').slice(0, 300) };
  } catch (err) {
    return { error: err instanceof BudgetExceeded ? 'budget exhausted' : err.message };
  }
}

// ---------- blinding ----------
// The judge must never learn which model wrote a reply. Wren's system prompt
// names the model it runs on, so replies can echo it; scrub model ids and
// vendor names before anything reaches the judge.
const VENDOR_WORDS = ['anthropic', 'claude', 'openai', 'chatgpt', 'gpt', 'deepseek', 'mistral', 'nemotron', 'nvidia', 'glm', 'zhipu', 'inclusionai', 'gemini', 'llama', 'qwen', 'haiku', 'sonnet', 'opus'];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function makeRedactor(modelIds) {
  const phrases = new Set();
  for (const id of modelIds) {
    const bare = id.replace(/^~/, '').replace(/:[^/]*$/, '');
    phrases.add(bare);
    phrases.add(bare.split('/').pop());
    for (const part of bare.split(/[/-]/)) if (/^[a-z]{3,}$/i.test(part) && !['flash', 'free', 'latest', 'ultra', 'pro', 'mini', 'large'].includes(part.toLowerCase())) phrases.add(part);
  }
  for (const w of VENDOR_WORDS) phrases.add(w);
  const sorted = [...phrases].filter(Boolean).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?<![\\w])(${sorted.map(escapeRe).join('|')})(?![\\w])`, 'gi');
  return (text) => String(text ?? '').replace(re, '[model]');
}

// ---------- semantic re-check of a failed reply-text check ----------
// Regexes are written against a few phrasings; a model that says the right
// thing in different words shouldn't lose the point. Only called for checks
// that failed, and never to overturn a failed critical "must not" check.
// An every-turn check can't be attributed to a single reply, so it isn't
// re-judged (judging just the last reply could wrongly rescue it).
export const eligibleForRecheck = (check) => !check.pass && !!check.semantic && !check.allTurns && !(check.critical && check.semantic === 'notMatch');

// The reply (and the user message it answered) that a failed check was
// actually evaluated against — per turn for multi-turn runs, per phrasing for
// variant sets. Returns null when it can't be determined.
export function recheckTarget(result, scenario, check) {
  if (check.turn != null) {
    const t = result.transcript?.[check.turn];
    if (t) return { reply: t.reply, scenario: { ...scenario, question: t.user } };
    if (check.turn === 0 && !result.transcript) return { reply: result.reply, scenario: { ...scenario, question: scenario.question ?? scenario.turns?.[0] } };
    return null;
  }
  if (check.variant != null) {
    const reply = result.variantReplies?.[check.variant];
    if (reply == null) return null;
    return { reply, scenario: { ...scenario, question: scenario.variants?.[check.variant] } };
  }
  const lastUser = result.transcript?.at(-1)?.user;
  return { reply: result.reply, scenario: { ...scenario, question: scenario.question ?? lastUser ?? (typeof scenario.turns?.at(-1) === 'string' ? scenario.turns.at(-1) : undefined) } };
}

export async function judgeRequirement(llm, judgeModel, scenario, reply, check) {
  const flagged = check.semantic === 'notMatch' && check.detail ? `\nAn automatic text check flagged this as a possible violation: ${check.detail}.` : '';
  try {
    const out = await askJson(llm, judgeModel,
      'You verify whether a chatbot reply satisfies ONE specific requirement. Judge meaning, not wording: paraphrases, synonyms, other formatting and other languages all count. Be strict about substance: for a positive requirement the reply must actually convey that information or behaviour; for a "does not" requirement the reply must genuinely avoid it (quoting or refusing something is not doing it). Respond with ONLY JSON: {"pass": true|false, "reason": "<one sentence>"}.',
      `${context(scenario)}\n\nREQUIREMENT: the reply ${check.label}.${check.rubric ? `\nHOW TO DECIDE: ${check.rubric}` : ''}${flagged}\n\nREPLY:\n${reply}`);
    if (typeof out.pass !== 'boolean') throw new Error('missing pass');
    return { pass: out.pass, reason: String(out.reason || '').slice(0, 300) };
  } catch (err) {
    return { error: err instanceof BudgetExceeded ? 'budget exhausted' : err.message };
  }
}
