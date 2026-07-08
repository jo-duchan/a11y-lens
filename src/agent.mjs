import { spawnSync } from 'node:child_process';

const TIMEOUT_MS = 180_000;

const AGENTS = {
  claude: {
    bin: 'claude',
    invoke(prompt) {
      const args = ['-p', '--output-format', 'text'];
      if (process.env.A11Y_LENS_MODEL) args.push('--model', process.env.A11Y_LENS_MODEL);
      return spawnSync('claude', args, {
        input: prompt,
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      });
    },
  },
  codex: {
    bin: 'codex',
    invoke(prompt) {
      return spawnSync('codex', ['exec', prompt], {
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      });
    },
  },
  cursor: {
    bin: 'cursor-agent',
    invoke(prompt) {
      return spawnSync('cursor-agent', ['-p', prompt, '--output-format', 'text'], {
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      });
    },
  },
};

const DETECTION_ORDER = ['claude', 'codex', 'cursor'];

function isInstalled(bin) {
  const result = spawnSync('/bin/sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' });
  return result.status === 0;
}

/** Pick an agent: explicit flag > A11Y_LENS_AGENT env > first installed. */
export function detectAgent(preferred) {
  const wanted = preferred || process.env.A11Y_LENS_AGENT;
  if (wanted) {
    const agent = AGENTS[wanted];
    if (!agent) return { error: `unknown agent "${wanted}" (claude | codex | cursor)` };
    if (!isInstalled(agent.bin)) return { error: `agent CLI "${agent.bin}" is not installed` };
    return { name: wanted, agent };
  }
  for (const name of DETECTION_ORDER) {
    if (isInstalled(AGENTS[name].bin)) return { name, agent: AGENTS[name] };
  }
  return { error: 'no agent CLI found (looked for: claude, codex, cursor-agent)' };
}

/** Run the review prompt through the agent. Returns { ok, output, error }. */
export function runAgent(agent, prompt) {
  let result;
  try {
    result = agent.invoke(prompt);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  if (result.error) return { ok: false, error: String(result.error) };
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || 'agent exited non-zero').trim().slice(0, 500) };
  }
  return { ok: true, output: result.stdout ?? '' };
}
