// Levels (`core` / `full`) and report (`errors` / `all`): what the agent is asked to check, and what
// the committer is shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { loadRules, filterRule } from '../src/prompt.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'a11y-lens.mjs');
const RULES_DIR = join(ROOT, 'skills', 'a11y-lens', 'references');
const ruleFiles = readdirSync(RULES_DIR).filter((n) => n.endsWith('.md')).sort();
const readRule = (name) => readFileSync(join(RULES_DIR, name), 'utf8');

/** Every numbered semantic check, with the tag it carries (or null). */
function semanticChecks(text) {
  const section = text.split(/(?=^## )/m).find((s) => s.startsWith('## Semantic checks')) ?? '';
  return section.split('\n').filter((l) => /^\d+\. /.test(l))
    .map((line) => ({ line, tag: line.match(/^\d+\. `\[(core|full)\]`/)?.[1] ?? null }));
}

function tempRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'a11y-lens-level-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

// ── the rule set ──────────────────────────────────────────────────────────────────────────────

test('every semantic check and every example carries exactly one level tag', () => {
  // A new check without a tag would be dropped from core silently — the kind of absence nothing
  // else would notice.
  for (const name of ruleFiles) {
    const text = readRule(name);
    const checks = semanticChecks(text);
    assert.ok(checks.length > 0, `${name} has no semantic checks`);
    for (const { line, tag } of checks) assert.ok(tag, `${name}: untagged check: ${line.slice(0, 60)}`);
    const examples = text.split(/(?=^## )/m).find((s) => s.startsWith('## Examples')) ?? '';
    for (const sub of examples.split(/(?=^### )/m).slice(1)) {
      assert.match(sub, /^### `\[(core|full)\]`/, `${name}: untagged example: ${sub.slice(0, 50)}`);
    }
  }
});

test('full sends the rule files exactly as written', () => {
  const { text, ids } = loadRules('full');
  assert.equal(text, ruleFiles.map(readRule).join('\n\n---\n\n'));
  assert.equal(ids.length, ruleFiles.length);
});

test('core sends every core check and example, and nothing tagged full', () => {
  const { text: core, ids } = loadRules('core');
  const { text: full } = loadRules('full');
  const all = ruleFiles.flatMap((n) => semanticChecks(readRule(n)));
  const coreChecks = all.filter((c) => c.tag === 'core');
  const fullChecks = all.filter((c) => c.tag === 'full');
  assert.equal(coreChecks.length, 15);
  for (const { line } of coreChecks) assert.ok(core.includes(line), `core is missing: ${line.slice(0, 60)}`);
  // The twin of the absence below: the same lines are really there at full, so "not in core" is
  // not true merely because the text never matched.
  for (const { line } of fullChecks) {
    assert.ok(full.includes(line), `full is missing: ${line.slice(0, 60)}`);
    assert.ok(!core.includes(line), `core still has: ${line.slice(0, 60)}`);
  }
  assert.ok(!core.includes('`[full]`'));
  // Files with no core check are left out whole, examples and all.
  assert.deepEqual(ids, ['images-alt', 'forms-labels', 'keyboard-interaction', 'focus-management']);
});

test('core never points the agent at a rule file it left out', () => {
  const { text, ids } = loadRules('core');
  const numbers = new Map(ruleFiles.map((n) => [n.slice(0, 2), readRule(n).match(/^id: (\S+)$/m)[1]]));
  for (const [, n] of text.matchAll(/rules\/(\d\d)/g)) {
    assert.ok(ids.includes(numbers.get(n)), `core refers to rules/${n}, which core does not send`);
  }
});

test('a file with no check at the level is dropped, and one with some keeps its intro', () => {
  const file = '---\nid: x\n---\n\n# X\n\n## Semantic checks\n\nIntro.\n\n1. `[full]` **A.**\n2. `[core]` **B.**\n\n## Examples\n\n### `[full]` A\n\nbad a\n\n### `[core]` B\n\nbad b\n';
  const core = filterRule(file, 'core');
  assert.match(core, /Intro\./);
  assert.match(core, /\*\*B\.\*\*/);
  assert.doesNotMatch(core, /\*\*A\.\*\*/);
  assert.match(core, /bad b/);
  assert.doesNotMatch(core, /bad a/);
  assert.equal(filterRule(file.replace('`[core]` **B.**', '`[full]` **B.**'), 'core'), null);
});

// ── settings ─────────────────────────────────────────────────────────────────────────────────

test('defaults to full and all, as every earlier version behaved', () => {
  const dir = tempRepo();
  try {
    assert.deepEqual(loadConfig({ cwd: dir, env: {}, warn: () => {} }), { level: 'full', report: 'all' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reads a11y-lens.config.json, else package.json, from the repository root', () => {
  const dir = tempRepo({ 'a11y-lens.config.json': '{"level":"core","report":"errors"}' });
  mkdirSync(join(dir, 'sub'));
  try {
    assert.deepEqual(loadConfig({ cwd: join(dir, 'sub'), env: {}, warn: () => {} }), { level: 'core', report: 'errors' });
    rmSync(join(dir, 'a11y-lens.config.json'));
    writeFileSync(join(dir, 'package.json'), '{"name":"x","a11y-lens":{"level":"core"}}');
    assert.deepEqual(loadConfig({ cwd: dir, env: {}, warn: () => {} }), { level: 'core', report: 'all' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the environment overrides the file, and a bad value falls through with a warning', () => {
  const dir = tempRepo({ 'a11y-lens.config.json': '{"level":"core","report":"errors"}' });
  const warnings = [];
  try {
    assert.deepEqual(
      loadConfig({ cwd: dir, env: { A11Y_LENS_LEVEL: 'full', A11Y_LENS_REPORT: 'loud' }, warn: (m) => warnings.push(m) }),
      { level: 'full', report: 'errors' },
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /ignoring report "loud" from A11Y_LENS_REPORT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unreadable or wrong-shaped setting is warned about and replaced by the default', () => {
  for (const body of ['{not json', '[]', '{"level":"basic"}']) {
    const dir = tempRepo({ 'a11y-lens.config.json': body });
    const warnings = [];
    try {
      assert.deepEqual(loadConfig({ cwd: dir, env: {}, warn: (m) => warnings.push(m) }), { level: 'full', report: 'all' }, body);
      assert.equal(warnings.length, 1, body);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ── the CLI end to end ───────────────────────────────────────────────────────────────────────

const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs');
let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  if (process.env.FAKE_ARGS) fs.writeFileSync(process.env.FAKE_ARGS, JSON.stringify(process.argv.slice(2)));
  fs.appendFileSync(process.env.FAKE_LOG, input + '\\n<<<END>>>\\n');
  process.stdout.write(process.env.FAKE_OUTPUT ?? '[]');
});
`;

function cliSandbox(config) {
  const dir = tempRepo(config ? { 'a11y-lens.config.json': JSON.stringify(config) } : {});
  const bin = mkdtempSync(join(tmpdir(), 'a11y-lens-bin-'));
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE);
  chmodSync(join(bin, 'claude'), 0o755);
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/A.tsx'), 'export const A = () => <button>Go</button>;\n');
  execFileSync('git', ['add', 'src/A.tsx'], { cwd: dir });
  const log = join(bin, 'prompts.log');
  const run = (args, env = {}) => spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir, encoding: 'utf8',
    env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: bin, A11Y_LENS_AGENT: 'claude', FAKE_LOG: log, ...env },
  });
  const lastPrompt = () => readFileSync(log, 'utf8').split('\n<<<END>>>\n').filter(Boolean).at(-1);
  const cleanup = () => { rmSync(dir, { recursive: true, force: true }); rmSync(bin, { recursive: true, force: true }); };
  return { dir, run, lastPrompt, cleanup };
}

const finding = (severity, message) => ({ file: 'src/A.tsx', line: 1, ruleId: 'keyboard-interaction', severity, message });
const FINDINGS = JSON.stringify([finding('error', 'ERR-ONE'), finding('warning', 'WARN-ONE'), finding('warning', 'WARN-TWO')]);

test('report errors shows the error, counts the hidden warnings, and still fails the commit', (t) => {
  const s = cliSandbox({ report: 'errors' });
  t.after(s.cleanup);
  const r = s.run(['check', '--staged'], { FAKE_OUTPUT: FINDINGS });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /ERR-ONE/);
  assert.doesNotMatch(r.stdout, /WARN-/);
  // On the footer, beside the totals — not above a footer that says there were none.
  assert.match(r.stdout.trim().split('\n').at(-1), /1 error\(s\).*2 warning\(s\) hidden/);
});

test('report all — the same answer — shows the warnings', (t) => {
  const s = cliSandbox();
  t.after(s.cleanup);
  const r = s.run(['check', '--staged'], { FAKE_OUTPUT: FINDINGS });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /WARN-ONE/);
  assert.doesNotMatch(r.stdout, /hidden/);
});

test('warnings alone under report errors pass quietly', (t) => {
  const s = cliSandbox({ report: 'errors' });
  t.after(s.cleanup);
  const r = s.run(['check', '--staged'], { FAKE_OUTPUT: JSON.stringify([finding('warning', 'WARN-ONE')]) });
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /WARN-ONE/);
  assert.match(r.stdout.trim().split('\n').at(-1), /no errors, .*1 warning\(s\) hidden/);
});

test('--strict shows warnings even under report errors, since they fail the commit', (t) => {
  const s = cliSandbox({ report: 'errors' });
  t.after(s.cleanup);
  const r = s.run(['check', '--staged', '--strict'], { FAKE_OUTPUT: JSON.stringify([finding('warning', 'WARN-ONE')]) });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /WARN-ONE/);
});

test('level core reaches the prompt, and so does the full-level twin', (t) => {
  const core = cliSandbox({ level: 'core' });
  const full = cliSandbox();
  t.after(() => { core.cleanup(); full.cleanup(); });
  core.run(['check', '--staged']);
  full.run(['check', '--staged']);
  assert.doesNotMatch(core.lastPrompt(), /`\[full\]`/);
  assert.match(core.lastPrompt(), /Check only the rules above/);
  // The severity guidance names no check the level left out, or the agent reviews it anyway.
  assert.doesNotMatch(core.lastPrompt(), /incomplete claimed ARIA patterns/);
  assert.match(full.lastPrompt(), /incomplete claimed ARIA patterns/);
  assert.match(full.lastPrompt(), /`\[full\]`/);
  assert.doesNotMatch(full.lastPrompt(), /Check only the rules above/);
  assert.match(core.lastPrompt(), /one of: images-alt \| forms-labels \| keyboard-interaction \| focus-management"/);
});

test('--pending reviews at the project level too', (t) => {
  const s = cliSandbox({ level: 'core' });
  t.after(s.cleanup);
  s.run(['check', '--staged'], { A11Y_LENS_TIMEOUT_MS: '1', FAKE_OUTPUT: '[]' });
  const pendingDir = join(s.dir, '.git', 'a11y-lens', 'pending');
  assert.equal(readdirSync(pendingDir).length, 1);
  s.run(['check', '--pending']);
  assert.doesNotMatch(s.lastPrompt(), /`\[full\]`/);
});

test('the reviewer runs with the host project\'s hooks turned off', (t) => {
  // A host Stop hook asking for `a11y-lens check --pending` made every reviewer start another review.
  const s = cliSandbox();
  t.after(s.cleanup);
  const argsFile = join(s.dir, 'args.json');
  s.run(['check', '--staged'], { FAKE_ARGS: argsFile });
  const args = JSON.parse(readFileSync(argsFile, 'utf8'));
  const at = args.indexOf('--settings');
  assert.ok(at >= 0, `no --settings in ${args.join(' ')}`);
  assert.deepEqual(JSON.parse(args[at + 1]), { disableAllHooks: true });
});
