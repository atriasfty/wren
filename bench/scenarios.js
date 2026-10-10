// WrenBench scenario index. Add new files under ./scenarios and list them here.
import { CORE } from './scenarios/core.js';
import { HARD_TOOLS } from './scenarios/hard-tools.js';
import { HARD_AUTH } from './scenarios/hard-auth.js';
import { HARD_INJECTION } from './scenarios/hard-injection.js';
import { HARD_GROUNDING } from './scenarios/hard-grounding.js';
import { HARD_MEMORY_PERSONA } from './scenarios/hard-memory-persona.js';
import { HARD_MISC } from './scenarios/hard-misc.js';

export const SCENARIOS = [...CORE, ...HARD_TOOLS, ...HARD_AUTH, ...HARD_INJECTION, ...HARD_GROUNDING, ...HARD_MEMORY_PERSONA, ...HARD_MISC];
export const CATEGORIES = [...new Set(SCENARIOS.map((s) => s.category))];
