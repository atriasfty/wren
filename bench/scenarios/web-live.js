// Live-web suite (--suite web): real questions answered with real search
// results, so different search providers (--search brave|exa) can be compared
// on the same model. Answers were verified against primary sources on
// 2026-10-16 and WILL go stale; re-verify (or replace the time-sensitive
// ones) before trusting a run made much later than that.
import { USER, called, replyMatches } from './common.js';

const live = (w) => { w.web.live = true; };

const q = (key, question, answer, label, extra = {}) => ({
  id: `web/${key}`, category: extra.category || 'web-current', actor: USER, estCalls: 3, maxSteps: 8,
  description: question, question, world: live,
  checks: [called('search_web'), ...[].concat(answer).map((re, i) => replyMatches(re, [].concat(label)[i]))],
});

export const WEB_LIVE = [
  // Recent news / events: tests freshness of the index.
  q('uk-pm', 'who is the uk prime minister right now?', /Burnham/i, 'Andy Burnham'),
  q('starmer-left', 'when did keir starmer stop being prime minister?', /20(th)? July|July 20/i, '20 July 2026'),
  q('apple-ceo', "who's apple's ceo now and when did they take over?", [/Ternus/i, /September|Sept|Sep\b|\b9\/1\b/i], ['John Ternus', 'September 2026']),
  q('f1-latest', 'who won the most recent f1 race?', [/Verstappen/i, /Singapore/i], ['Verstappen', 'Singapore GP']),
  q('f1-singapore-podium', 'who was on the podium at the 2026 singapore grand prix?', [/Verstappen/i, /Leclerc/i, /Antonelli/i], ['P1 Verstappen', 'P2 Leclerc', 'P3 Antonelli']),
  q('f1-leader', "who's leading the f1 drivers championship right now?", /Antonelli/i, 'Kimi Antonelli'),
  q('world-cup', 'who won the 2026 world cup and who did they beat in the final?', [/Spain/i, /Argentina/i], ['Spain', 'beat Argentina']),
  q('iphone', "what's the newest iphone apple has announced?", /iPhone 18 Pro|iPhone Fold|foldable|iPhone Duo/i, 'iPhone 18 Pro (or the foldable)'),
  q('dublin-weather', "what's the high in dublin today?", /\b1[1-4]\s*(°|degrees|C\b)|\b5[2-7]\s*(°|degrees|F\b)/i, '11-14 C'),

  // Software versions: tests whether results reflect the latest release.
  q('node-lts', "what's the latest node.js lts version number?", /24\.22(\.0)?/, 'v24.22.0', { category: 'web-versions' }),
  q('discordjs', "what's the latest stable discord.js version?", /14\.27(\.0)?/, '14.27.0', { category: 'web-versions' }),
  q('react', "what's the current latest react version?", /19\.3\.1/, '19.3.1', { category: 'web-versions' }),
  q('typescript', "what's the newest typescript release?", /7\.0\.2/, '7.0.2', { category: 'web-versions' }),
  q('postgres', "what's the latest postgresql minor release?", /18\.6/, '18.6', { category: 'web-versions' }),
  q('node-schedule', 'is node.js changing its release schedule? from which version?', [/\b27\b/, /annual|yearly|once a year|every year|each year|a year|one (major )?release (a|per) year/i], ['from Node 27', 'annual releases'], { category: 'web-versions' }),

  // Technical / niche lookups: tests relevance on docs-style questions.
  q('erlc-auth', 'what header do i put my server key in for the erlc private server api?', /server-key/i, 'Server-Key header', { category: 'web-docs' }),
  q('cv2-flag', 'in discord.js what message flag do i need to send components v2?', /IsComponentsV2/, 'MessageFlags.IsComponentsV2', { category: 'web-docs' }),
  q('pgvector-empty', 'which pgvector index can i create on an empty table, hnsw or ivfflat?', /HNSW/i, 'HNSW', { category: 'web-docs' }),
  q('australia', 'what is the capital of australia? look it up', /Canberra/i, 'Canberra', { category: 'web-docs' }),
];

export const WEB_CATEGORIES = ['web-current', 'web-versions', 'web-docs'];
