// Answer keys for the hard suite are computed from what Wren's tools return,
// never from the world's internals. dumpViaTools() calls the same fake
// executor a model would (as a mod), so any answer derived from the dump is,
// by construction, reachable through the tools.
//
// The same two batches double as the oracle's plan: batch A (server-wide
// tools) then batch B (per-player tools for every online player), then an
// answer. Three model steps in total.
import { makeWorldExecutor } from '../world.js';
import { makeTenantCtx, makeActor } from '../fixtures.js';

export const BATCH_A = [
  ['get_server_briefing', {}],
  ['get_wanted_players', {}],
  ['list_online_players', {}],
  ['get_vehicles', {}],
  ['search_command_logs', { limit: 100 }],
];

export function batchB(onlineNames) {
  return onlineNames.flatMap((u) => [
    ['get_player_profile', { username: u }],
    ['get_player_info', { username: u }],
    ['check_punishments', { username: u }],
    ['analyze_player_activity', { username: u }],
    ['lookup_roblox_profile', { username: u }],
  ]);
}

export const onlineNamesFrom = (listResult) => Object.values(listResult?.players || {}).flat();

// Builds the dump structure from (tool name, args, result) triples, so the
// oracle can rebuild it from tool messages and the answer key from direct calls.
export function assembleDump(entries) {
  const d = { players: {} };
  for (const { name, args, result } of entries) {
    if (!result || result.success === false) continue;
    if (name === 'get_server_briefing') d.briefing = result;
    else if (name === 'get_wanted_players') d.wanted = result.wantedPlayers;
    else if (name === 'list_online_players') d.online = onlineNamesFrom(result);
    else if (name === 'get_vehicles') d.vehicles = result.vehicles;
    else if (name === 'search_command_logs') d.commands = result.logs;
    else {
      const u = args.username;
      const p = (d.players[u] ||= {});
      if (name === 'get_player_profile') p.profile = result;
      if (name === 'get_player_info') p.info = result;
      if (name === 'check_punishments') p.punishments = result.punishments;
      if (name === 'analyze_player_activity') p.activity = result;
      if (name === 'lookup_roblox_profile') p.roblox = result;
    }
  }
  return d;
}

export async function dumpViaTools(world) {
  // Deep copy: the dump must not consume injected faults or trigger events.
  const w = JSON.parse(JSON.stringify({ ...world, faults: [], onCall: undefined }));
  const { runTool } = makeWorldExecutor(w, makeTenantCtx(), makeActor({ kind: 'discord', rank: 'owner', name: 'dumper' }));
  const entries = [];
  for (const [name, args] of BATCH_A) entries.push({ name, args, result: await runTool(name, args) });
  const online = onlineNamesFrom(entries.find((e) => e.name === 'list_online_players').result);
  for (const [name, args] of batchB(online)) entries.push({ name, args, result: await runTool(name, args) });
  return assembleDump(entries);
}

// "N minutes ago" -> N
export const minutes = (at) => Number(String(at).match(/(\d+)\s*minute/)?.[1] ?? NaN);
