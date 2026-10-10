// OpenRouter client with a hard call budget and cost tracking. Every model
// request the bench makes, including judge calls, goes through a Budget, so
// a run can never exceed --max-calls no matter how a model behaves.
import OpenAI from 'openai';

export class BudgetExceeded extends Error {
  constructor(reason) { super(`budget exhausted: ${reason}`); this.name = 'BudgetExceeded'; }
}

export class Budget {
  constructor({ name, maxCalls, maxCostUsd = Infinity, shared = null }) {
    Object.assign(this, { name, maxCalls, maxCostUsd, shared });
    this.calls = 0; this.promptTokens = 0; this.completionTokens = 0; this.costUsd = 0; this.costKnown = true; this.failures = 0;
  }

  get exhausted() {
    return this.calls >= this.maxCalls || this.costUsd >= this.maxCostUsd || !!this.shared?.exhausted;
  }

  // Reserve a call slot synchronously, so concurrent scenarios cannot overshoot.
  take() {
    if (this.calls >= this.maxCalls) throw new BudgetExceeded(`${this.name} hit ${this.maxCalls} calls`);
    if (this.costUsd >= this.maxCostUsd) throw new BudgetExceeded(`${this.name} hit $${this.maxCostUsd}`);
    this.shared?.take();
    this.calls++;
  }

  record(usage) {
    if (!usage) { this.costKnown = false; return; }
    this.promptTokens += usage.prompt_tokens || 0;
    this.completionTokens += usage.completion_tokens || 0;
    if (typeof usage.cost === 'number') this.costUsd += usage.cost; else this.costKnown = false;
    this.shared?.record(usage);
  }
}

function openRouter(apiKey) {
  return new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    maxRetries: 2,
    timeout: 120_000,
    defaultHeaders: { 'HTTP-Referer': 'https://atriasafety.org', 'X-Title': 'WrenBench' },
  });
}

// Deterministic stand-in for --mock: exercises the whole harness for free.
function mockClient() {
  return {
    chat: {
      completions: {
        create: async (params) => {
          const json = params.response_format?.type === 'json_object';
          const content = json
            ? JSON.stringify({ approved: true, reason: 'mock', score: 3, winner: 'tie', pass: false })
            : 'mock reply.';
          const promptChars = JSON.stringify(params.messages).length;
          return {
            choices: [{ message: { role: 'assistant', content } }],
            usage: { prompt_tokens: Math.round(promptChars / 4), completion_tokens: 5, cost: 0 },
          };
        },
      },
    },
  };
}

const RATE_LIMIT_RETRIES = 6; // ~3 minutes of backoff in total
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns an OpenAI-shaped client whose create() is metered by `budget`.
export function budgetedClient({ apiKey, mock, budget, maxTokens }) {
  const base = mock ? mockClient() : openRouter(apiKey);
  const create = async (params) => {
    budget.take();
    for (let attempt = 0; ; attempt++) {
      try {
        const resp = await base.chat.completions.create({
          ...params,
          max_tokens: params.max_tokens ?? maxTokens,
          usage: { include: true }, // OpenRouter: report cost in usage
        });
        budget.record(resp.usage);
        return resp;
      } catch (err) {
        // Free-tier models rate-limit hard. Rejected requests aren't billed,
        // so back off and retry the same slot instead of failing the scenario.
        if (err?.status === 429 && attempt < RATE_LIMIT_RETRIES) {
          await sleep(Math.min(60_000, 5_000 * 2 ** attempt));
          continue;
        }
        budget.failures++;
        throw err;
      }
    }
  };
  return { chat: { completions: { create } } };
}
