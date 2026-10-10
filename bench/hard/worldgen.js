// Seeded generator for a full, messy ERLC server. Everything is derived from
// the seed, so a run is reproducible, and a new seed gives fresh worlds (and
// fresh answers) that a model cannot have memorized.
import { defaultWorld } from '../world.js';
import { CHANNEL_ID } from '../fixtures.js';

export function rng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    shuffle: (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
  };
}

const FIRST = ['Shadow', 'Blaze', 'Rook', 'Viper', 'Echo', 'Nova', 'Ghost', 'Raven', 'Storm', 'Frost', 'Jet', 'Onyx', 'Pixel', 'Rusty', 'Ember', 'Kodiak', 'Maple', 'Bishop', 'Cobalt', 'Delta', 'Falcon', 'Harbor', 'Indigo', 'Juno', 'Kestrel', 'Lark', 'Marlow', 'Nimbus', 'Orion', 'Piper', 'Quill', 'Ridge', 'Sable', 'Thistle', 'Umber', 'Vesper', 'Willow', 'Yarrow', 'Zephyr', 'Atlas'];
const SECOND = ['Runner', 'Driver', 'Cop', 'Medic', 'King', 'Rider', 'Hawk', 'Wolf', 'Fox', 'Bear', 'Lynx', 'Pilot', 'Ranger', 'Scout', 'Trooper', 'Deputy'];
const STREETS = [['Elm Street', 100], ['Main Street', 100], ['Bank Street', 100], ['Liberty Avenue', 200], ['Oak Lane', 200], ['Station Road', 200], ['Route 9 North', 300], ['Pine Road', 300], ['Harbor Road', 400], ['Industrial Way', 400], ['Mill Creek Drive', 500], ['Ridgeview Court', 500]];
const CARS = ['Falcon Stallion 350', 'Bullhorn Prancer', 'Chevlon Camion', 'Overland Apache', 'Navara Imperium', 'Leland LTS', 'Vellfire Evertt', 'Chevlon Corbeta', 'Falcon Interceptor', 'Stuttgart Executive'];
const COLORS = ['Red', 'Black', 'White', 'Blue', 'Silver', 'Green', 'Yellow', 'Orange'];
const TEAM_LIVERY = { Police: 'LCPD Marked', Sheriff: 'Sheriff Marked', Fire: 'LCFD Command', DOT: 'DOT Utility' };
const REASONS = ['RDM', 'VDM', 'Fail RP', 'NITRP', 'Cop baiting', 'Exploiting', 'Mic spam', 'Trolling'];
export const STAFF_PERMS = ['Server Moderator', 'Server Administrator', 'Server Owner'];

// Look-alike spelling: O→0, l→I, i→1, rn→m. Returns null when nothing to swap.
function lookalike(name, r) {
  const swaps = [[/o/, '0'], [/O/, '0'], [/l/, 'I'], [/i/, '1'], [/rn/, 'm'], [/e/, '3']];
  for (const [re, rep] of r.shuffle(swaps)) if (re.test(name)) return name.replace(re, rep);
  return null;
}

export function generateWorld(seed) {
  const r = rng(seed);
  const w = defaultWorld();
  const used = new Set();
  const mkName = () => {
    for (;;) {
      const n = `${r.pick(FIRST)}${r.pick(['', '_', 'The'])}${r.pick(SECOND)}${r.chance(0.6) ? r.int(1, 99) : ''}`;
      if (!used.has(n.toLowerCase())) { used.add(n.toLowerCase()); return n; }
    }
  };

  // ---- players: 40 online, ~5 staff, look-alike pairs, a few offline people
  const teams = ['Civilian', 'Civilian', 'Civilian', 'Civilian', 'Police', 'Police', 'Sheriff', 'Sheriff', 'Fire', 'DOT'];
  const players = [];
  for (let i = 0; i < 37; i++) {
    const [street, base] = r.pick(STREETS);
    const team = r.pick(teams);
    players.push({
      username: mkName(), team, permission: 'Normal',
      callsign: team === 'Civilian' ? null : `${{ Police: '2L', Sheriff: '3S', Fire: 'M', DOT: 'D' }[team]}-${String(r.int(1, 40)).padStart(2, '0')}`,
      wanted: team === 'Civilian' && r.chance(0.3) ? r.int(1, 5) : 0,
      street, postal: String(base + r.int(1, 99)), accountAgeDays: r.chance(0.15) ? r.int(1, 13) : r.int(30, 2500),
    });
  }
  const staffIdx = r.shuffle([...players.keys()]).slice(0, 5);
  staffIdx.forEach((idx, k) => { players[idx].permission = k === 0 ? 'Server Administrator' : k === 1 ? 'Server Administrator' : 'Server Moderator'; players[idx].wanted = 0; });
  // three look-alike pairs: the twin has different team/wanted/history
  const twins = [];
  for (const idx of r.shuffle([...players.keys()]).filter((i) => !staffIdx.includes(i)).slice(0, 3)) {
    const twinName = lookalike(players[idx].username, r);
    if (!twinName || used.has(twinName.toLowerCase())) continue;
    used.add(twinName.toLowerCase());
    const [street, base] = r.pick(STREETS);
    const twin = { ...players[idx], username: twinName, street, postal: String(base + r.int(1, 99)), wanted: players[idx].wanted ? 0 : r.int(1, 4), team: 'Civilian', callsign: null, accountAgeDays: r.int(1, 10) };
    players.push(twin);
    twins.push([players[idx].username, twinName]);
  }
  w.players = players;
  w.offline = [mkName(), mkName(), mkName()];

  // ---- vehicles: most non-staff own one; some civilians use emergency liveries
  w.vehicles = [];
  for (const p of players) {
    if (r.chance(0.3)) continue;
    const civLivery = p.team === 'Civilian' && r.chance(0.15) ? r.pick(Object.values(TEAM_LIVERY)) : null;
    w.vehicles.push({ owner: p.username, name: r.pick(CARS), color: r.pick(COLORS), livery: p.team !== 'Civilian' ? TEAM_LIVERY[p.team] : civLivery });
  }

  // ---- punishments, including offline players and the look-alike twins
  w.punishments = {};
  const everyone = [...players.map((p) => p.username), ...w.offline];
  for (const u of everyone) {
    if (!r.chance(0.35)) continue;
    w.punishments[u] = Array.from({ length: r.int(1, 4) }, () => {
      const day = r.int(1, 30);
      return { type: r.pick(['Warn', 'Warn', 'Kick', 'Ban']), reason: r.pick(REASONS), createdAt: `2026-09-${String(day).padStart(2, '0')}T${String(r.int(10, 23)).padStart(2, '0')}:00:00Z`, server: 'Liberty County Roleplay' };
    }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // ---- kill logs (most recent first), numeric minutesAgo alongside the text
  const shooters = r.shuffle(players.filter((p) => !STAFF_PERMS.includes(p.permission))).slice(0, 10);
  w.killLogs = Array.from({ length: 45 }, () => {
    const killer = r.pick(shooters).username;
    let victim = r.pick(players).username;
    if (victim === killer) victim = players[(players.findIndex((p) => p.username === killer) + 1) % players.length].username;
    const minutesAgo = r.int(1, 120);
    return { killer, victim, minutesAgo, at: `${minutesAgo} minutes ago` };
  }).sort((a, b) => a.minutesAgo - b.minutesAgo);

  // ---- staff command logs
  const staff = players.filter((p) => STAFF_PERMS.includes(p.permission));
  const cmds = [];
  for (let i = 0; i < 110; i++) {
    const s = r.pick(staff);
    const target = r.pick(players).username;
    const kind = r.pick([':wanted', ':wanted', ':kick', ':tp', ':pm', ':h', ':jail', ':unwanted']);
    const command = kind === ':h' ? `:h ${r.pick(['peak hours, follow the rules', 'no VDM at the bank', 'training at 8', 'staff on duty, report in tickets'])}`
      : kind === ':pm' ? `:pm ${target} ${r.pick(['please stop', 'check tickets', 'warning for NITRP'])}`
      : kind === ':kick' ? `:kick ${target} ${r.pick(REASONS)}`
      : kind === ':tp' ? `:tp ${s.username} ${target}` : `${kind} ${target}`;
    const minutesAgo = r.int(1, 180);
    cmds.push({ player: s.username, command, minutesAgo, at: `${minutesAgo} minutes ago` });
  }
  w.commandLogs = cmds.sort((a, b) => a.minutesAgo - b.minutesAgo);

  w.modcalls = Array.from({ length: 9 }, () => {
    const caller = r.pick(players).username; const about = r.pick(shooters).username; const minutesAgo = r.int(1, 90);
    return { caller, about, reason: `${about} ${r.pick(['keeps RDMing at the bank', 'is ramming cars on Route 9', 'is spawn killing', 'is mic spamming'])}`, minutesAgo, at: `${minutesAgo} minutes ago` };
  }).sort((a, b) => a.minutesAgo - b.minutesAgo);
  w.emergencyCalls = Array.from({ length: 6 }, () => {
    const [street] = r.pick(STREETS); const minutesAgo = r.int(1, 60);
    return { team: r.pick(['Police', 'Sheriff', 'Fire']), caller: r.pick(players).username, description: `${r.pick(['shots fired', 'car fire', 'reckless driver', 'robbery in progress', 'injured person'])} on ${street}`, street, minutesAgo, at: `${minutesAgo} minutes ago` };
  }).sort((a, b) => a.minutesAgo - b.minutesAgo);
  w.maxPlayers = 50;
  w.queue = 0;
  w.channels = [
    { id: CHANNEL_ID, name: 'general', messages: [] },
    { id: '700000000000000002', name: 'staff-chat', messages: [] },
    { id: '700000000000000003', name: 'reports', messages: [] },
  ];
  w.meta = { seed, twins, staff: staff.map((s) => s.username) };
  return w;
}
