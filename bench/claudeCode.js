// Judge backend that shells out to the Claude Code CLI in non-interactive
// mode (`claude -p`), exposed through the same OpenAI-shaped
// chat.completions.create() interface as llm.js so judge.js doesn't care.
//
// Each call is isolated: the system prompt is replaced (not appended), all
// tools and MCP servers are disabled, settings files (and their hooks) are not
// loaded, no session is saved, and it runs from the OS temp dir so no
// CLAUDE.md is picked up. Auth is whatever the CLI is already logged in with.
import { spawn } from 'child_process';
import os from 'os';

const CALL_TIMEOUT_MS = 180_000;
const PER_CALL_MAX_USD = '0.50';

function textOf(content) {
  if (typeof content === 'string') return content;
  return (content || []).map((p) => p.text || '').join('');
}

function runClaude(args, stdin, { bin }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`claude timed out after ${CALL_TIMEOUT_MS / 1000}s`)); }, CALL_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e.code === 'ENOENT' ? new Error(`"${bin}" not found on PATH (install Claude Code or set WRENBENCH_CLAUDE_BIN)`) : e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let parsed;
      try { parsed = JSON.parse(out); } catch {
        return reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(0, 300)}`));
      }
      if (parsed.is_error) return reject(new Error(`claude: ${String(parsed.result || parsed.subtype).slice(0, 300)}`));
      resolve(parsed);
    });
    child.stdin.end(stdin);
  });
}

// model: a Claude Code model alias or id ('sonnet', 'opus', ...) or null for
// the CLI's configured default.
export function claudeCodeClient({ model = null, budget, bin = process.env.WRENBENCH_CLAUDE_BIN || 'claude' }) {
  const create = async (params) => {
    budget.take();
    const system = params.messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n\n');
    const user = params.messages.filter((m) => m.role !== 'system').map((m) => textOf(m.content)).join('\n\n');
    const wantsJson = params.response_format?.type === 'json_object';
    const args = [
      '-p', '--output-format', 'json',
      '--system-prompt', system + (wantsJson ? '\n\nOutput only the JSON object: no prose, no code fences.' : ''),
      '--tools', '',
      '--strict-mcp-config',
      '--setting-sources', '',
      '--no-session-persistence',
      '--max-budget-usd', PER_CALL_MAX_USD,
      ...(model ? ['--model', model] : []),
    ];
    try {
      const r = await runClaude(args, user, { bin });
      const u = r.usage || {};
      const usage = {
        prompt_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        completion_tokens: u.output_tokens || 0,
        ...(typeof r.total_cost_usd === 'number' ? { cost: r.total_cost_usd } : {}),
      };
      budget.record(usage);
      return { choices: [{ message: { role: 'assistant', content: r.result } }], usage };
    } catch (err) {
      budget.failures++;
      throw err;
    }
  };
  return { chat: { completions: { create } } };
}

// "claude-code" or "claude-code:<model>" → { model } ; anything else → null
export function parseClaudeCodeJudge(spec) {
  const m = /^claude-code(?::(.+))?$/.exec(spec || '');
  return m ? { model: m[1] || null } : null;
}
