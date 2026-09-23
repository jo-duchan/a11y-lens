// Runs the real CLI in a throwaway git repo against a fake `claude` on PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'a11y-lens.mjs');

// Behaviour is chosen per prompt, so one run can mix outcomes across `--pending` batches:
// a file containing SLOW sleeps past the timeout, GARBAGE answers prose, ERROR reports an error.
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs');
let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, input + '\\n<<<END>>>\\n');
  if (input.includes('SLOW')) { setTimeout(() => process.stdout.write('[]'), 5000); return; }
  if (input.includes('GARBAGE')) { process.stdout.write('I could not decide.'); return; }
  if (input.includes('ERROR')) {
    process.stdout.write(JSON.stringify([{ file: 'x', line: 1, ruleId: 'images-alt', severity: 'error', message: 'bad' }]));
    return;
  }
  process.stdout.write('[]');
});
`;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'a11y-lens-test-'));
  const repo = join(dir, 'repo');
  const bin = join(dir, 'bin');
  mkdirSync(repo);
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE);
  chmodSync(join(bin, 'claude'), 0o755);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const log = join(dir, 'prompts.log');
  const env = {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: dir,
    A11Y_LENS_AGENT: 'claude',
    A11Y_LENS_TIMEOUT_MS: '1500',
    FAKE_LOG: log,
  };
  const run = (args, extraEnv = {}, cwd = repo) =>
    spawnSync(process.execPath, [BIN, ...args], { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8' });
  const stage = (path, body) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), body);
    git('add', path);
  };
  const pendingDir = join(repo, '.git', 'a11y-lens', 'pending');
  const pending = () =>
    existsSync(pendingDir)
      ? readdirSync(pendingDir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(pendingDir, n), 'utf8')))
      : [];
  const prompts = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n<<<END>>>\n').filter(Boolean) : []);
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return { dir, repo, git, run, stage, pending, pendingDir, prompts, cleanup, env };
}

const ui = (marker = '') => `export const A = () => <button onClick={() => {}}>Go ${marker}</button>;\n`;

test('a timed-out staged check records every file it did not review', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  s.stage('src/A.tsx', ui('SLOW'));
  s.stage('src/B.tsx', ui());
  const r = s.run(['check', '--staged']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /recorded 2 unreviewed file\(s\) as pending/);
  const entries = s.pending();
  assert.deepEqual(entries.map((e) => e.path).sort(), ['src/A.tsx', 'src/B.tsx']);
  for (const e of entries) {
    assert.equal(e.version, 1);
    assert.match(e.reason, /ETIMEDOUT/);
    assert.match(e.blob, /^[0-9a-f]{40}$/);
    assert.match(e.diff, /^diff --git/);
    assert.equal(e.worktree, execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: s.repo, encoding: 'utf8' }).trim());
  }
});

test('the same fixture reviewed in time records nothing', (t) => {
  // The absence assertion's twin: identical staging to the test above, only the timeout differs,
  // so a recorder that never ran cannot pass both.
  const s = sandbox();
  t.after(s.cleanup);
  s.stage('src/A.tsx', ui('SLOW'));
  s.stage('src/B.tsx', ui());
  const r = s.run(['check', '--staged'], { A11Y_LENS_TIMEOUT_MS: '20000' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(s.pending(), []);
});

test('unparseable agent output is recorded', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  s.stage('src/A.tsx', ui('GARBAGE'));
  const r = s.run(['check', '--staged']);
  assert.equal(r.status, 0);
  assert.deepEqual(s.pending().map((e) => e.path), ['src/A.tsx']);
  assert.match(s.pending()[0].reason, /could not parse/);
});

test('only the files dropped for the prompt budget are recorded', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  const big = (n) => `export const B${n} = () => <p>${'x'.repeat(45_000)}</p>;\n`;
  for (let i = 0; i < 4; i++) s.stage(`src/Big${i}.tsx`, big(i));
  const r = s.run(['check', '--staged']);
  assert.equal(r.status, 0, r.stderr);
  const paths = s.pending().map((e) => e.path);
  assert.ok(paths.length >= 1 && paths.length < 4, `expected a partial drop, got ${paths}`);
  for (const p of paths) assert.match(r.stderr, new RegExp(`dropped ${p}`));
  assert.equal(s.pending()[0].reason, 'prompt size budget exceeded');
});

test('an intentional skip and a missing agent record nothing', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  s.stage('src/A.tsx', ui('SLOW'));
  assert.equal(s.run(['check', '--staged'], { A11Y_LENS_SKIP: '1' }).status, 0);
  assert.equal(s.run(['check', '--staged'], { PATH: `${dirname(process.execPath)}:/usr/bin:/bin` }).status, 0);
  assert.deepEqual(s.pending(), []);
  // …while the same staging does record once the agent is present — so the two above are not vacuous.
  s.run(['check', '--staged']);
  assert.equal(s.pending().length, 1);
});

test('an aborted commit retried as it was is cleared by the retry', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  s.stage('src/A.tsx', ui('SLOW'));
  s.run(['check', '--staged']);
  assert.equal(s.pending().length, 1);
  // Nothing committed (typecheck failed in parallel, say); the same content is committed again.
  const r = s.run(['check', '--staged'], { A11Y_LENS_TIMEOUT_MS: '20000' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(s.pending(), []);
});

test('a skipped commit that landed is not cleared by the next edit to the file', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  s.stage('src/A.tsx', ui('SLOW'));
  s.run(['check', '--staged']);
  s.git('commit', '-qm', 'skipped but landed');
  // The next commit's diff is only this one-line change; the skipped content is now baseline.
  s.stage('src/A.tsx', ui('SLOW') + '// tweak\n');
  const r = s.run(['check', '--staged'], { A11Y_LENS_TIMEOUT_MS: '20000' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.pending().length, 1);
});

test('a file whose diff alone overflows the budget is reviewed without it, not dropped', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  // A rewrite: ~180KB before, ~45KB after — the diff carries both.
  const line = (i, tag) => `export const V${i} = () => <p>${tag}${'y'.repeat(60)}</p>;\n`;
  s.stage('src/Big.tsx', Array.from({ length: 1800 }, (_, i) => line(i, 'old')).join(''));
  s.git('commit', '-qm', 'big');
  s.stage('src/Big.tsx', Array.from({ length: 440 }, (_, i) => line(i, 'new')).join(''));
  assert.ok(Buffer.byteLength(s.git('diff', '--cached')) > 160_000, 'fixture must overflow on its diff');
  const r = s.run(['check', '--staged'], { A11Y_LENS_TIMEOUT_MS: '20000' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /dropped/);
  assert.deepEqual(s.pending(), []);
  assert.doesNotMatch(s.prompts().at(-1), /Staged diff for src\/Big\.tsx/);
});

test('a check run from a subdirectory still records the staged diff', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  s.stage('src/A.tsx', ui('SLOW'));
  const r = s.run(['check', '--staged'], {}, join(s.repo, 'src'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(s.pending()[0].diff, /^diff --git a\/src\/A\.tsx/);
});

test('an unreadable record is reported with where it lives', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  mkdirSync(s.pendingDir, { recursive: true });
  writeFileSync(join(s.pendingDir, 'future.json'), JSON.stringify({ version: 2 }));
  const r = s.run(['check', '--pending']);
  assert.equal(r.status, 0);
  assert.ok(r.stderr.includes(s.pendingDir.replace(/^\/private/, '')) || r.stderr.includes(s.pendingDir), r.stderr);
  assert.match(r.stderr, /delete them by hand/);
});

test('recording the same path again keeps one entry, with the newer skip', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  s.stage('src/A.tsx', ui('SLOW'));
  s.stage('src/B.tsx', ui('SLOW'));
  s.run(['check', '--staged']);
  const first = Object.fromEntries(s.pending().map((e) => [e.path, e]));
  s.git('reset', '-q');
  s.stage('src/B.tsx', ui('SLOW again'));
  s.stage('src/C.tsx', ui('SLOW'));
  s.run(['check', '--staged']);
  const after = Object.fromEntries(s.pending().map((e) => [e.path, e]));
  assert.deepEqual(Object.keys(after).sort(), ['src/A.tsx', 'src/B.tsx', 'src/C.tsx']);
  assert.ok(after['src/B.tsx'].at > first['src/B.tsx'].at);
  assert.notEqual(after['src/B.tsx'].blob, first['src/B.tsx'].blob);
});

test('the next run warns about pending files even when nothing UI is staged', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  s.stage('src/A.tsx', ui('SLOW'));
  s.run(['check', '--staged']);
  s.git('reset', '-q');
  s.stage('notes.txt', 'plain\n');
  const r = s.run(['check', '--staged']);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /1 file\(s\) from earlier commits were never reviewed/);
  assert.match(r.stderr, /a11y-lens check --pending/);
  // and it says nothing when there is nothing to say
  rmSync(s.pendingDir, { recursive: true });
  assert.doesNotMatch(s.run(['check', '--staged']).stderr, /never reviewed/);
});

test('--pending reviews the recorded diff and clears what it reviewed', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  s.stage('src/A.tsx', ui('SLOW'));
  s.stage('src/B.tsx', ui());
  s.run(['check', '--staged']);
  s.git('commit', '-qm', 'skipped');
  // The fix for the slow file lands later; --pending must review what was committed, not this.
  writeFileSync(join(s.repo, 'src/A.tsx'), ui('fixed'));
  const r = s.run(['check', '--pending'], { A11Y_LENS_TIMEOUT_MS: '20000' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(s.pending(), []);
  const prompt = s.prompts().at(-1);
  assert.match(prompt, /Staged diff for src\/A\.tsx/);
  assert.match(prompt, /Go SLOW/);
  assert.doesNotMatch(prompt, /Go fixed/);
});

test('--pending reports errors and still clears the entry', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  s.stage('src/A.tsx', ui('SLOW'));
  s.run(['check', '--staged']);
  // Point the entry at a working-tree file that now draws an error from the fake agent.
  const [name] = readdirSync(s.pendingDir);
  const e = JSON.parse(readFileSync(join(s.pendingDir, name), 'utf8'));
  writeFileSync(join(s.pendingDir, name), JSON.stringify({ ...e, blob: null, diff: '' }));
  writeFileSync(join(s.repo, 'src/A.tsx'), ui('ERROR'));
  const r = s.run(['check', '--pending']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /1 error\(s\)/);
  assert.deepEqual(s.pending(), []);
});

test('--pending keeps entries it could not review', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  s.stage('src/A.tsx', ui('SLOW'));
  s.run(['check', '--staged']);
  const r = s.run(['check', '--pending']);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /1 file\(s\) stay pending/);
  assert.equal(s.pending().length, 1);
});

test('--pending clears batch by batch, and a timed-out batch stays', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  for (const [name, marker] of [['One', 'GARBAGE'], ['Two', 'SLOW'], ['Three', 'GARBAGE']]) {
    s.git('reset', '-q');
    s.stage(`src/${name}.tsx`, ui(marker));
    s.run(['check', '--staged']);
  }
  assert.equal(s.pending().length, 3);
  // Rewrite the recorded content so batches One and Three now review cleanly and Two still times out.
  const dir = s.pendingDir;
  for (const n of readdirSync(dir)) {
    const e = JSON.parse(readFileSync(join(dir, n), 'utf8'));
    if (e.path !== 'src/Two.tsx') {
      writeFileSync(join(s.repo, e.path), ui('clean'));
      writeFileSync(join(dir, n), JSON.stringify({ ...e, blob: null, diff: '' }));
    }
  }
  const r = s.run(['check', '--pending']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(s.pending().map((e) => e.path), ['src/Two.tsx']);
  assert.match(r.stderr, /1 file\(s\) are still pending/);
});

test('--pending keeps a file its own batch dropped for the budget', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  const big = (n) => `export const B${n} = () => <p>${'x'.repeat(45_000)}</p>;\n`;
  for (let i = 0; i < 4; i++) s.stage(`src/Big${i}.tsx`, `${big(i)}// SLOW\n`);
  s.run(['check', '--staged']);
  assert.equal(s.pending().length, 4);
  const r = s.run(['check', '--pending'], { A11Y_LENS_TIMEOUT_MS: '20000' });
  assert.equal(r.status, 0, r.stderr);
  const left = s.pending().length;
  assert.ok(left >= 1 && left < 4, `expected the dropped file(s) to stay, got ${left}`);
  assert.match(r.stderr, /it stays pending/);
});

test('a removed worktree does not turn its unreviewed files into cleared ones', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  const wt = join(s.dir, 'wt');
  s.git('worktree', 'add', '-q', '-b', 'side', wt);
  mkdirSync(join(wt, 'src'));
  writeFileSync(join(wt, 'src/W.tsx'), ui('SLOW'));
  execFileSync('git', ['add', 'src/W.tsx'], { cwd: wt });
  const recorded = s.run(['check', '--staged'], {}, wt);
  assert.equal(recorded.status, 0);
  execFileSync('git', ['commit', '-qm', 'w'], { cwd: wt });
  s.git('worktree', 'remove', '--force', wt);
  assert.equal(s.pending().length, 1, 'recorded in the common dir, visible from the main checkout');
  const r = s.run(['check', '--pending'], { A11Y_LENS_TIMEOUT_MS: '20000' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /dropping pending/);
  assert.match(s.prompts().at(-1), /Go SLOW/);
  assert.deepEqual(s.pending(), []);
});

test('an entry whose blob and file are both gone is dropped with a reason', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  s.stage('src/A.tsx', ui('SLOW'));
  s.run(['check', '--staged']);
  const [name] = readdirSync(s.pendingDir);
  const e = JSON.parse(readFileSync(join(s.pendingDir, name), 'utf8'));
  writeFileSync(join(s.pendingDir, name), JSON.stringify({ ...e, blob: '0'.repeat(40) }));
  s.git('reset', '-q');
  rmSync(join(s.repo, 'src/A.tsx'));
  const r = s.run(['check', '--pending']);
  assert.match(r.stderr, /dropping pending src\/A\.tsx/);
  assert.deepEqual(s.pending(), []);
});

test('a pending directory that cannot be written never blocks the commit', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  mkdirSync(join(s.repo, '.git', 'a11y-lens'));
  writeFileSync(s.pendingDir, 'not a directory');
  s.stage('src/A.tsx', ui('SLOW'));
  const r = s.run(['check', '--staged']);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /could not record 1 unreviewed file/);
});

test('a bad timeout value falls back to the default with a warning', (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  s.stage('src/A.tsx', ui());
  for (const bad of ['abc', '0', '-5', '1.5']) {
    const r = s.run(['check', '--staged'], { A11Y_LENS_TIMEOUT_MS: bad });
    assert.equal(r.status, 0);
    assert.match(r.stderr, new RegExp(`ignoring A11Y_LENS_TIMEOUT_MS="${bad.replace('.', '\\.')}"`));
  }
  // and a good one is taken as given: a clean file under a 1ms limit cannot be reviewed in time.
  s.git('reset', '-q');
  s.stage('src/B.tsx', ui());
  s.run(['check', '--staged'], { A11Y_LENS_TIMEOUT_MS: '1' });
  assert.deepEqual(s.pending().map((e) => e.path), ['src/B.tsx']);
});

test('two commits recording at once both survive', async (t) => {
  const s = sandbox();
  t.after(s.cleanup);
  const wt = join(s.dir, 'wt');
  s.git('worktree', 'add', '-q', '-b', 'side', wt);
  s.stage('src/Main.tsx', ui('SLOW'));
  mkdirSync(join(wt, 'src'));
  writeFileSync(join(wt, 'src/Side.tsx'), ui('SLOW'));
  execFileSync('git', ['add', 'src/Side.tsx'], { cwd: wt });
  const go = (cwd) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [BIN, 'check', '--staged'], { cwd, env: s.env });
      p.on('exit', resolve);
    });
  await Promise.all([go(s.repo), go(wt)]);
  assert.deepEqual(s.pending().map((e) => e.path).sort(), ['src/Main.tsx', 'src/Side.tsx']);
});
