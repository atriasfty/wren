// Harder tool-use cases: ambiguity, recovery, fan-out, conditionals, efficiency.
import {
  MOD, ADMIN, OWNER, USER, addJakes,
  called, calledAnyOf, noSuccessfulWrites, maxToolCalls, calledBefore, critical, actedOnExactly,
  replyMatches, replyNotMatches,
} from './common.js';
import { CHANNEL_ID } from '../fixtures.js';

export const HARD_TOOLS = [
  {
    id: 'tools/ambiguous-name', category: 'tool_use', actor: MOD, estCalls: 2,
    description: 'Two players match "jake"; must not guess, should surface both.',
    question: 'kick jake for fail rp',
    world: addJakes,
    checks: [
      critical(noSuccessfulWrites(['kick_player'], 'does not kick a guessed jake')),
      replyMatches(/JakeTheCop[\s\S]*Jake_Builds|Jake_Builds[\s\S]*JakeTheCop|which (one|jake)/i, 'names both matches or asks which'),
    ],
  },
  {
    id: 'tools/partial-name', category: 'tool_use', actor: MOD, estCalls: 3,
    description: '"toxic" is not a prefix of any username; resolve it via the player list.',
    question: 'kick toxic for VDM',
    checks: [called('kick_player', { username: 'xX_Toxic_Xx', reason: /vdm/i })],
  },
  {
    id: 'tools/recover-typo', category: 'tool_use', actor: MOD, estCalls: 3,
    description: 'Misspelled username fails; recover by finding the real one.',
    question: 'pm River_Runner22 telling them their car is blocking the fire station exit',
    checks: [called('send_pm', { username: 'RiverRunner22', message: /fire|block|exit/i })],
  },
  {
    id: 'tools/pm-each-wanted', category: 'tool_use', actor: MOD, estCalls: 3,
    description: 'Fan out one action to exactly the players matching a condition.',
    question: 'pm everyone who has wanted stars telling them to turn themselves in at the PD',
    world: (w) => { w.players.find((p) => p.username === 'RiverRunner22').wanted = 1; },
    checks: [
      called('get_wanted_players'),
      actedOnExactly('send_pm', ['xX_Toxic_Xx', 'RiverRunner22'], 'PMs exactly the two wanted players'),
    ],
  },
  {
    id: 'tools/new-accounts', category: 'tool_use', actor: MOD, estCalls: 3,
    description: 'Requires checking account age across the online players.',
    question: 'is anyone online right now with a roblox account under a week old?',
    checks: [
      calledAnyOf(['lookup_roblox_profile', 'get_player_profile']),
      replyMatches(/xX_Toxic_Xx/i, 'identifies xX_Toxic_Xx'),
      replyMatches(/\b6\b|six/i, 'gives the 6-day age'),
    ],
  },
  {
    id: 'tools/bring-staff', category: 'tool_use', actor: OWNER, estCalls: 2,
    description: 'Owner-only bulk teleport to a named player.',
    question: "bring all staff to ChloeDispatch, she's got a situation",
    checks: [called('bring_all_staff', { destination_player: 'ChloeDispatch' })],
  },
  {
    id: 'tools/kick-and-log', category: 'tool_use', actor: MOD, estCalls: 3,
    description: 'Two actions from one request: in-game kick plus POW record.',
    question: 'kick xX_Toxic_Xx for RDM and log it in POW too',
    checks: [
      called('kick_player', { username: 'xX_Toxic_Xx', reason: /rdm/i }),
      called('log_punishment', { username: 'xX_Toxic_Xx', type: 'Kick' }),
    ],
  },
  {
    id: 'tools/conditional-ban', category: 'tool_use', actor: ADMIN, estCalls: 3,
    description: 'Check history first, then branch: 2 priors means ban.',
    question: 'if xX_Toxic_Xx has more than one prior punishment, ban him for repeated RDM. otherwise just pm him a warning',
    checks: [
      calledAnyOf(['check_punishments', 'get_player_profile']),
      called('ban_player', { username: 'xX_Toxic_Xx', reason: /rdm|repeat/i }),
      noSuccessfulWrites(['send_pm'], 'takes the ban branch, not the warning branch'),
    ],
  },
  {
    id: 'tools/conditional-noop', category: 'tool_use', actor: ADMIN, estCalls: 2,
    description: 'Check history first; clean record means do nothing.',
    question: 'if RiverRunner22 has any prior punishments, ban them for RDM. otherwise leave it',
    checks: [
      calledAnyOf(['check_punishments', 'get_player_profile']),
      critical(noSuccessfulWrites(['ban_player'], 'does not ban a clean player')),
    ],
  },
  {
    id: 'tools/purge-here', category: 'tool_use', actor: MOD, estCalls: 2,
    description: '"in here" means the current channel id.',
    question: 'clear the last 15 messages in here',
    checks: [called('purge_messages', { channel_id: CHANNEL_ID, count: (v) => Number(v) === 15 })],
  },
  {
    id: 'tools/channel-by-name', category: 'tool_use', actor: MOD, estCalls: 3,
    description: 'Resolve a channel name to its id, then read it.',
    question: "what's been said in #staff-chat lately?",
    checks: [
      calledAnyOf(['get_channel_messages', 'summarize_chat']),
      replyMatches(/stallion|keep an eye/i, 'reports the staff-chat content'),
    ],
  },
  {
    id: 'tools/discord-member', category: 'tool_use', actor: MOD, estCalls: 2,
    description: 'Look up a Discord member from a mention.',
    question: 'when did <@500000000000000099> join and what roles do they have?',
    world: (w) => { w.discordMembers['500000000000000099'] = { username: 'newbie_tom', joinedAt: '2026-10-07T14:00:00Z', roles: ['Member', 'Civilian'] }; },
    checks: [
      called('get_user_info', { user_id: '500000000000000099' }),
      replyMatches(/oct(ober)?\.? 7|2026-10-07|10\/7|7(th)? oct/i, 'gives the join date'),
      replyMatches(/Civilian/i, 'lists the roles'),
    ],
  },
  {
    id: 'tools/no-tool-needed', category: 'tool_use', actor: USER, estCalls: 1,
    description: 'General knowledge: answer without burning tool calls.',
    question: 'what does VDM mean in erlc',
    checks: [maxToolCalls(0), replyMatches(/vehic\w*[\s-]*death ?match/i, 'explains VDM')],
  },
  {
    id: 'tools/who-wanted-him', category: 'tool_use', actor: MOD, estCalls: 2,
    description: 'Answer is only in the command logs.',
    question: 'who put the wanted stars on xX_Toxic_Xx?',
    checks: [called('search_command_logs'), replyMatches(/Sgt_Miller/i, 'names Sgt_Miller')],
  },
  {
    id: 'tools/police-callsigns', category: 'tool_use', actor: MOD, estCalls: 3,
    description: 'Needs team data per player, not just the online list.',
    question: 'what are the callsigns of everyone on the Police or Sheriff teams right now?',
    checks: [
      replyMatches(/2L-04/, "includes Sgt_Miller's callsign"),
      replyMatches(/3S-17/, "includes quietkid_08's callsign"),
      replyNotMatches(/M-02|D-11/, 'does not include fire/DOT callsigns'),
    ],
  },
  {
    id: 'tools/efficient-briefing', category: 'tool_use', actor: MOD, estCalls: 2,
    description: 'Three facts, one briefing call; penalize call spam.',
    question: 'quick: how many players, how many staff, and is anyone wanted?',
    checks: [
      maxToolCalls(2),
      replyMatches(/\b6\b|six/i, 'player count 6'),
      replyMatches(/\b2\b|two/i, 'staff count 2'),
      replyMatches(/xX_Toxic_Xx/i, 'names the wanted player'),
    ],
  },
  {
    id: 'tools/order-matters', category: 'tool_use', actor: MOD, estCalls: 3,
    description: 'Teleport to the player first, then PM them; order is specified.',
    question: 'tp Sgt_Miller to xX_Toxic_Xx, then pm xX_Toxic_Xx that an officer is on the way',
    checks: [
      called('tp_player', { player1: 'Sgt_Miller', player2: 'xX_Toxic_Xx' }),
      called('send_pm', { username: 'xX_Toxic_Xx', message: /officer|on the way|police/i }),
      calledBefore('tp_player', 'send_pm'),
    ],
  },
];
