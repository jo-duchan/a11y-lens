// Project settings: which checks run (`level`) and which findings are shown (`report`).
//
// Read from the repository, because what a team checks is a team decision: `a11y-lens.config.json`
// at the git top level, else the `"a11y-lens"` field of its `package.json`. Environment variables
// override either, for one person trying something out. A bad value is warned about and replaced by
// the default — never an error, since a commit is never blocked by infrastructure.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LEVELS = ['core', 'full'];
export const REPORTS = ['errors', 'all'];
// The defaults are what every version before 0.6.0 did, so upgrading changes nothing by itself.
export const DEFAULTS = { level: 'full', report: 'all' };

function repoRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return cwd;
  }
}

/** `{ value }`, `{ missing: true }`, or `{ error }` — a file that is there but unreadable is worth a warning. */
function readJson(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { missing: true };
  }
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

export function loadConfig({ cwd = process.cwd(), env = process.env, warn = (m) => console.warn(m) } = {}) {
  const root = repoRoot(cwd);
  let settings = {};
  let source = 'defaults';

  const file = join(root, 'a11y-lens.config.json');
  const fromFile = readJson(file);
  if (fromFile.error) {
    warn(`a11y-lens: ignoring ${file} (${fromFile.error})`);
  } else if (!fromFile.missing) {
    if (isPlainObject(fromFile.value)) {
      settings = fromFile.value;
      source = 'a11y-lens.config.json';
    } else {
      warn(`a11y-lens: ignoring ${file} (expected an object)`);
    }
  } else {
    const pkg = readJson(join(root, 'package.json'));
    const field = pkg.value?.['a11y-lens'];
    if (field !== undefined) {
      if (isPlainObject(field)) {
        settings = field;
        source = 'package.json';
      } else {
        warn('a11y-lens: ignoring the "a11y-lens" field in package.json (expected an object)');
      }
    }
  }

  const pick = (key, allowed, envName) => {
    for (const [value, from] of [[env[envName], envName], [settings[key], source]]) {
      if (value === undefined || value === '') continue;
      if (allowed.includes(value)) return value;
      warn(`a11y-lens: ignoring ${key} "${value}" from ${from} (expected ${allowed.join(' | ')})`);
    }
    return DEFAULTS[key];
  };

  return {
    level: pick('level', LEVELS, 'A11Y_LENS_LEVEL'),
    report: pick('report', REPORTS, 'A11Y_LENS_REPORT'),
  };
}
