#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectStagedUIFiles, collectPathArgs } from '../src/staged.mjs';
import { installHook, detectRunner } from '../src/hooks.mjs';
import { detectAgent, runAgent } from '../src/agent.mjs';
import { buildPrompt } from '../src/prompt.mjs';
import { parseFindings, printReport, exitCodeFor } from '../src/report.mjs';
import { recordPending, listPending, clearReviewed, clearEntry, contentOf, pendingDir } from '../src/pending.mjs';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `a11y-lens — AI-powered semantic accessibility linter

Usage:
  a11y-lens check --staged            review staged UI files (for git hooks)
  a11y-lens check <files...>          review specific files
  a11y-lens check --pending           review files an earlier check skipped
  a11y-lens init                      install the pre-commit hook (lefthook/husky/git hooks,
                                      auto-detected) + inject rules reference into ./AGENTS.md
  a11y-lens rules                     list rule categories

Options for check:
  --agent <claude|codex|cursor>       force a specific agent CLI (default: auto-detect)
  --strict                            exit non-zero on warnings too (default: errors only)

Options for init:
  --no-hook                           skip hook installation (AGENTS.md only)

Environment:
  A11Y_LENS_AGENT                     same as --agent
  A11Y_LENS_MODEL                     model override passed to claude (optional)
  A11Y_LENS_SKIP=1                    skip the check entirely (escape hatch)
  A11Y_LENS_TIMEOUT_MS                agent timeout in ms (default 180000)

Infrastructure failures (no agent CLI, no network, agent error) never block:
a11y-lens warns and exits 0. Only accessibility findings gate. When a staged
check could not review a file (agent failure or timeout, unparseable output,
prompt budget), the file is recorded as pending until a later run reviews it.`;

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--staged' || token === '--strict' || token === '--no-hook' || token === '--pending') {
      args.flags[token.slice(2)] = true;
    }
    else if (token === '--agent') args.flags.agent = argv[++i];
    else if (token === '--help' || token === '-h') args.flags.help = true;
    else args._.push(token);
  }
  return args;
}

const RECHECK = 'a11y-lens check --pending';

function softFail(message) {
  console.warn(`a11y-lens: ${message} — skipping check (commits are never blocked by infrastructure).`);
  process.exit(0);
}

/** Record what a staged run could not review, and say so where the committer will see it. */
const RUN_STARTED = new Date();

function notePending(files, reason) {
  const result = recordPending(files, reason, { now: RUN_STARTED });
  if (result.error) {
    console.warn(`a11y-lens: could not record ${files.length} unreviewed file(s) as pending (${result.error}).`);
  } else {
    console.warn(`a11y-lens: recorded ${result.recorded} unreviewed file(s) as pending — review them later with: ${RECHECK}`);
  }
}

function skipStaged(files, message) {
  notePending(files, message);
  softFail(message);
}

function warnUnreadable(count) {
  console.warn(
    `a11y-lens: ${count} pending record(s) in ${pendingDir()} could not be read (another a11y-lens version, or damaged). ` +
      'This version never clears them; delete them by hand once you have dealt with them.',
  );
}

/**
 * Before anything can exit early (a skip, a commit with no UI files): a skipped check looks like a
 * clean one, so the next run is the first chance to say it happened.
 */
function warnPending() {
  const { entries, unreadable } = listPending();
  if (entries.length) {
    console.warn(
      `a11y-lens: ${entries.length} file(s) from earlier commits were never reviewed (the check was skipped). Review them with: ${RECHECK}`,
    );
  }
  if (unreadable) {
    warnUnreadable(unreadable);
  }
}

function commandCheck(args) {
  if (args.flags.pending) return commandCheckPending(args);
  warnPending();
  if (process.env.A11Y_LENS_SKIP === '1') softFail('A11Y_LENS_SKIP=1');

  const staged = Boolean(args.flags.staged);
  const { files, error } = staged ? collectStagedUIFiles() : collectPathArgs(args._);
  if (error) softFail(error);

  const reviewable = files.filter((f) => !f.skipped);
  for (const f of files.filter((f) => f.skipped)) {
    console.warn(`a11y-lens: skipping ${f.path} (${f.skipped})`);
  }
  if (reviewable.length === 0) {
    if (staged) console.log('a11y-lens: no staged UI files, nothing to review.');
    else console.log('a11y-lens: no reviewable files given. Try: a11y-lens check src/Component.tsx');
    process.exit(0);
  }

  const detection = detectAgent(args.flags.agent);
  if (detection.error) softFail(detection.error);

  const { prompt, dropped } = buildPrompt(reviewable);
  for (const path of dropped) {
    console.warn(`a11y-lens: dropped ${path} (prompt size budget exceeded)`);
  }
  const included = reviewable.filter((f) => !dropped.includes(f.path));
  if (staged && dropped.length) {
    notePending(reviewable.filter((f) => dropped.includes(f.path)), 'prompt size budget exceeded');
  }

  if (included.length === 0) process.exit(0);
  console.log(`a11y-lens: reviewing ${included.length} file(s) with ${detection.name}…`);
  const result = runAgent(detection.agent, prompt);
  if (!result.ok) {
    if (staged) skipStaged(included, `agent failed: ${result.error}`);
    softFail(`agent failed: ${result.error}`);
  }

  const parsed = parseFindings(result.output);
  if (parsed.error) {
    if (staged) skipStaged(included, parsed.error);
    softFail(parsed.error);
  }

  // Reviewed now, so an entry left by an earlier skip of the same path — say, a commit that
  // typecheck aborted in parallel — is answered.
  if (staged) clearReviewed(included.map((f) => f.path));

  printReport(parsed.findings, { agentName: detection.name });
  process.exit(exitCodeFor(parsed.findings, { strict: args.flags.strict }));
}

/**
 * Review what earlier staged runs skipped. One agent call per recorded skip, not one for all of
 * them: a bad session leaves dozens of entries, and a single prompt that big would time out again
 * and never let the list shrink. Each batch clears only what it actually reviewed.
 */
function commandCheckPending(args) {
  const { entries, unreadable } = listPending();
  if (unreadable) {
    warnUnreadable(unreadable);
  }
  if (entries.length === 0) {
    console.log('a11y-lens: nothing pending.');
    process.exit(0);
  }

  const detection = detectAgent(args.flags.agent);
  if (detection.error) softFail(`${detection.error}; ${entries.length} file(s) remain pending`);

  const batches = new Map();
  for (const item of [...entries].sort((a, b) => a.entry.at.localeCompare(b.entry.at))) {
    const key = `${item.entry.worktree}\0${item.entry.at}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(item);
  }

  const findings = [];
  let remaining = 0;
  for (const batch of batches.values()) {
    const files = [];
    for (const item of batch) {
      const found = contentOf(item.entry);
      if (found.gone) {
        console.warn(`a11y-lens: dropping pending ${item.entry.path} (${found.gone})`);
        clearEntry(item);
        continue;
      }
      files.push({ path: item.entry.path, content: found.content, diff: item.entry.diff, item });
    }
    if (files.length === 0) continue;

    const { prompt, dropped } = buildPrompt(files);
    const included = files.filter((f) => !dropped.includes(f.path));
    if (included.length === 0) {
      console.warn(`a11y-lens: every file skipped at ${batch[0].entry.at} exceeds the prompt budget — they stay pending.`);
      remaining += files.length;
      continue;
    }
    console.log(
      `a11y-lens: reviewing ${included.length} pending file(s) skipped at ${batch[0].entry.at} with ${detection.name}…`,
    );
    const result = runAgent(detection.agent, prompt);
    const parsed = result.ok ? parseFindings(result.output) : { error: `agent failed: ${result.error}` };
    if (parsed.error) {
      console.warn(`a11y-lens: ${parsed.error} — ${files.length} file(s) stay pending.`);
      remaining += files.length;
      continue;
    }
    findings.push(...parsed.findings);
    for (const f of files) {
      if (dropped.includes(f.path)) {
        console.warn(`a11y-lens: dropped ${f.path} (prompt size budget exceeded) — it stays pending.`);
        remaining++;
      } else {
        clearEntry(f.item);
      }
    }
  }

  printReport(findings, { agentName: detection.name });
  if (remaining) console.warn(`a11y-lens: ${remaining} file(s) are still pending — run ${RECHECK} again.`);
  process.exit(exitCodeFor(findings, { strict: args.flags.strict }));
}

function commandInit(args) {
  // 1. Pre-commit hook (lefthook / husky / plain git hooks, auto-detected)
  if (!args.flags['no-hook']) {
    const result = installHook(process.cwd());
    console.log(`a11y-lens: [${result.system}] ${result.message}`);
  } else {
    console.log(`a11y-lens: hook skipped (--no-hook). Manual command: ${detectRunner(process.cwd())} a11y-lens check --staged`);
  }

  // 2. Rules reference for interactive agents
  const snippet = readFileSync(join(PACKAGE_ROOT, 'templates', 'agents-snippet.md'), 'utf8').trimEnd();
  const target = join(process.cwd(), 'AGENTS.md');
  const begin = '<!-- a11y-lens:begin -->';
  const end = '<!-- a11y-lens:end -->';

  if (existsSync(target)) {
    const current = readFileSync(target, 'utf8');
    const pattern = new RegExp(`${begin}[\\s\\S]*?${end}`);
    const updated = pattern.test(current)
      ? current.replace(pattern, snippet)
      : `${current.trimEnd()}\n\n${snippet}\n`;
    writeFileSync(target, updated);
    console.log(`a11y-lens: ${pattern.test(current) ? 'updated' : 'appended'} rules section in AGENTS.md`);
  } else {
    writeFileSync(target, `${snippet}\n`);
    console.log('a11y-lens: created AGENTS.md with rules section');
  }

  console.log(`
Richer write-time guidance for skills-capable agents: npx skills add jo-duchan/a11y-lens
Escape hatches: A11Y_LENS_SKIP=1 git commit …  |  git commit --no-verify`);
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
args._ = args._.slice(1);

if (args.flags.help || !command) {
  console.log(HELP);
  process.exit(0);
}

switch (command) {
  case 'check':
    commandCheck(args);
    break;
  case 'init':
    commandInit(args);
    break;
  case 'rules': {
    const rulesDir = join(PACKAGE_ROOT, 'skills', 'a11y-lens', 'references');
    for (const name of readdirSync(rulesDir).filter((n) => n.endsWith('.md')).sort()) {
      console.log(`${name}  →  ${join(rulesDir, name)}`);
    }
    break;
  }
  default:
    console.error(`a11y-lens: unknown command "${command}"\n`);
    console.log(HELP);
    process.exit(2);
}
