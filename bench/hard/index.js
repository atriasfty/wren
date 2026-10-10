// WrenBench-Hard: built from a seed so every run is reproducible and a new
// --seed gives fresh worlds and answers.
import { buildResearch } from './research.js';
import { buildOperations } from './operations.js';
import { buildConversations } from './conversations.js';

export async function buildHardSuite(seed = 1) {
  const base = seed * 100_000;
  return [...await buildResearch(base), ...buildOperations(base), ...buildConversations(base)];
}

export const HARD_CATEGORIES = ['research', 'tool_use', 'grounding', 'injection', 'authorization', 'multi_turn', 'redteam'];
