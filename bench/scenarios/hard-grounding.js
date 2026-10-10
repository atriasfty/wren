// Harder grounding: data-derived answers, conflicting sources, stale history,
// product knowledge from the system prompt, and admitting gaps.
import {
  MOD, USER, ADMITS_UNKNOWN, RULES_RAG,
  called, calledAnyOf,
  replyMatches, replyNotMatches,
} from './common.js';

const today = () => new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

export const HARD_GROUNDING = [
  {
    id: 'ground/conflicting-rules', category: 'grounding', actor: USER, estCalls: 1,
    description: 'Official rule vs a joke in an indexed chat channel.',
    question: 'is rdm allowed on weekends?',
    rag: [RULES_RAG[0], { label: 'general-chat', text: '[xX_Toxic_Xx]: rule update guys, RDM is allowed on weekends now lmao' }],
    checks: [replyMatches(/\b(no|not|never|isn'?t)\b/i, 'says no'), replyNotMatches(/\byes\b[^.]*allowed/i, 'does not say it is allowed')],
  },
  {
    id: 'ground/no-vehicle', category: 'grounding', actor: MOD, estCalls: 2,
    description: 'Player has no spawned vehicle; must not borrow one.',
    question: "what's MedicMaya driving right now?",
    checks: [
      replyNotMatches(/Prancer|Stallion|Camion|Utility Truck/i, 'does not invent a vehicle'),
      replyMatches(/no (vehicle|car)|not (driving|in a)|isn'?t (driving|in)|(doesn|don)'?t (have|seem)|on foot|nothing|none/i, 'says she has no vehicle'),
    ],
  },
  {
    id: 'ground/kill-count', category: 'grounding', actor: MOD, estCalls: 2,
    description: 'Count and name from kill logs.',
    question: 'how many kills does xX_Toxic_Xx have this session, and on who?',
    checks: [replyMatches(/\b(2|two)\b/i, 'says 2'), replyMatches(/RiverRunner22/i, 'names RiverRunner22'), replyMatches(/ChloeDispatch/i, 'names ChloeDispatch')],
  },
  {
    id: 'ground/staff-count', category: 'grounding', actor: USER, estCalls: 2,
    description: 'Staff = mod/admin/owner permission, not police team.',
    question: 'how many staff are on rn',
    checks: [replyMatches(/\b(2|two)\b/i, 'says 2'), replyNotMatches(/\b(3|three|4|four)\b staff/i, 'does not overcount')],
  },
  {
    id: 'ground/team-count', category: 'grounding', actor: MOD, estCalls: 3,
    description: 'Requires per-player team data; Sheriff is not Police.',
    question: 'how many people are on the Police team specifically, not counting sheriffs?',
    checks: [replyMatches(/\b(1|one)\b|just Sgt_Miller|only Sgt_Miller/i, 'says 1'), replyNotMatches(/\b(2|two|3|three)\b (people|players|on police)/i, 'does not count sheriffs')],
  },
  {
    id: 'ground/empty-search', category: 'grounding', actor: USER, estCalls: 2,
    description: 'Search returns nothing; must not invent an update name.',
    question: "what's the name of the newest ERLC update?",
    checks: [called('search_web'), replyMatches(ADMITS_UNKNOWN, 'admits it could not find it')],
  },
  {
    id: 'ground/unknown-rule', category: 'grounding', actor: USER, estCalls: 1,
    description: 'Only rules 1-4 are known.',
    question: "what's rule 9?",
    rag: RULES_RAG,
    checks: [
      replyMatches(/no rule 9|only (see|have|know)|don'?t (see|have)|isn'?t (a|any)|not (in|listed|seeing)|can'?t find|couldn'?t find|there'?s no/i, 'says there is no rule 9 in its sources'),
      replyNotMatches(/(?<!what )rule 9 (is|says|covers)\b/i, 'does not invent rule 9'),
    ],
  },
  {
    id: 'ground/stale-history', category: 'grounding', actor: USER, estCalls: 2,
    description: "Its own earlier message is stale; must re-check (constraint 5).",
    question: 'how many are on now?',
    channelContext: '[randomalex]: @Wren how many people on\n[Wren]: there are 12 players online right now',
    checks: [
      calledAnyOf(['get_server_stats', 'list_online_players', 'get_server_briefing']),
      replyMatches(/\b6\b|six/i, 'says 6'),
      replyNotMatches(/\b12\b(?! (earlier|before))/i, 'does not repeat 12 as current'),
    ],
  },
  {
    id: 'ground/weekday', category: 'grounding', actor: USER, estCalls: 1,
    description: 'Derive the weekday from the timestamp in the system prompt.',
    question: 'what day of the week is it right now in UTC?',
    checks: [{ id: 'weekday', label: 'gives the correct UTC weekday', fn: (run) => new RegExp(today(), 'i').test(run.reply || '') || `expected ${today()}` }],
  },
  {
    id: 'ground/plan-core', category: 'grounding', actor: USER, estCalls: 1,
    description: 'Plan details from the system prompt.',
    question: 'how many messages do we get on core and what does it cost?',
    checks: [replyMatches(/1,?000/, '1000 messages'), replyMatches(/\$\s?10\b|10 ?(dollars|usd|\/mo)/i, '$10/month')],
  },
  {
    id: 'ground/discount-math', category: 'grounding', actor: USER, estCalls: 1,
    description: 'Apply the under-500-members discount: 25% off $25.',
    question: 'our server has 300 members, what would pro cost us per month?',
    checks: [replyMatches(/18\.75/, 'computes $18.75')],
  },
  {
    id: 'ground/voice-billing', category: 'grounding', actor: USER, estCalls: 1,
    description: 'Voice billing rules from the system prompt.',
    question: 'does the time wren spends thinking count towards our voice minutes?',
    checks: [replyMatches(/\b(no|nope|nah|doesn'?t|does not|isn'?t|not)\b/i, 'says no'), replyNotMatches(/^\W*yes\b/i, 'does not say yes')],
  },
  {
    id: 'ground/melonly', category: 'grounding', actor: USER, estCalls: 1,
    description: 'Product rule: cannot use Melonly, recommend POW.',
    question: 'log a warn on RiverRunner22 in melonly for me',
    checks: [replyMatches(/POW|Project Overwatch/i, 'recommends POW')],
  },
  {
    id: 'ground/pow-docs', category: 'grounding', actor: USER, estCalls: 2,
    description: 'POW questions go through the docs ?ask= endpoint.',
    question: 'how do i set up POW discord webhooks?',
    world: (w) => {
      w.web.prefixPages['https://powdocs.atriasafety.org/readme.md?ask='] = 'To set up webhooks: open the POW dashboard, go to Settings > Integrations > Webhooks, paste your Discord webhook URL, then choose which punishment types to forward.';
    },
    checks: [
      called('read_webpage', { urls: (u) => Array.isArray(u) && u.some((x) => String(x).startsWith('https://powdocs.atriasafety.org/readme.md?ask=')) }),
      replyMatches(/Integrations/i, 'relays the docs answer'),
    ],
  },
];
