#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectStagedUIFiles, collectPathArgs } from '../src/staged.mjs';
import { detectAgent, runAgent } from '../src/agent.mjs';
import { buildPrompt } from '../src/prompt.mjs';
import { parseFindings, printReport, exitCodeFor } from '../src/report.mjs';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `a11y-lens — AI-powered semantic accessibility linter

Usage:
  a11y-lens check --staged            review staged UI files (for git hooks)
  a11y-lens check <files...>          review specific files
  a11y-lens init                      inject rules reference into ./AGENTS.md + print hook setup
  a11y-lens rules                     list rule categories

Options for check:
  --agent <claude|codex|cursor>       force a specific agent CLI (default: auto-detect)
  --strict                            exit non-zero on warnings too (default: errors only)

Environment:
  A11Y_LENS_AGENT                     same as --agent
  A11Y_LENS_MODEL                     model override passed to claude (optional)
  A11Y_LENS_SKIP=1                    skip the check entirely (escape hatch)

Infrastructure failures (no agent CLI, no network, agent error) never block:
a11y-lens warns and exits 0. Only accessibility findings gate.`;

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--staged' || token === '--strict') args.flags[token.slice(2)] = true;
    else if (token === '--agent') args.flags.agent = argv[++i];
    else if (token === '--help' || token === '-h') args.flags.help = true;
    else args._.push(token);
  }
  return args;
}

function softFail(message) {
  console.warn(`a11y-lens: ${message} — skipping check (commits are never blocked by infrastructure).`);
  process.exit(0);
}

function commandCheck(args) {
  if (process.env.A11Y_LENS_SKIP === '1') softFail('A11Y_LENS_SKIP=1');

  const { files, error } = args.flags.staged
    ? collectStagedUIFiles()
    : collectPathArgs(args._);
  if (error) softFail(error);

  const reviewable = files.filter((f) => !f.skipped);
  for (const f of files.filter((f) => f.skipped)) {
    console.warn(`a11y-lens: skipping ${f.path} (${f.skipped})`);
  }
  if (reviewable.length === 0) {
    if (args.flags.staged) console.log('a11y-lens: no staged UI files, nothing to review.');
    else console.log('a11y-lens: no reviewable files given. Try: a11y-lens check src/Component.tsx');
    process.exit(0);
  }

  const detection = detectAgent(args.flags.agent);
  if (detection.error) softFail(detection.error);

  const { prompt, dropped } = buildPrompt(reviewable);
  for (const path of dropped) {
    console.warn(`a11y-lens: dropped ${path} (prompt size budget exceeded)`);
  }

  console.log(
    `a11y-lens: reviewing ${reviewable.length - dropped.length} file(s) with ${detection.name}…`,
  );
  const result = runAgent(detection.agent, prompt);
  if (!result.ok) softFail(`agent failed: ${result.error}`);

  const parsed = parseFindings(result.output);
  if (parsed.error) softFail(parsed.error);

  printReport(parsed.findings, { agentName: detection.name });
  process.exit(exitCodeFor(parsed.findings, { strict: args.flags.strict }));
}

function commandInit() {
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
Hook setup — pick the one your repo uses:

  lefthook.yml:
    pre-commit:
      jobs:
        - name: a11y-lens
          run: npx a11y-lens check --staged

  husky (.husky/pre-commit):
    npx a11y-lens check --staged

  plain git hook (.git/hooks/pre-commit, chmod +x):
    #!/bin/sh
    npx a11y-lens check --staged

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
    commandInit();
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
