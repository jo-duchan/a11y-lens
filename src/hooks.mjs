import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const LEFTHOOK_FILES = ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.lefthook.yaml'];

/** Pick the runner prefix from the repo's lockfile. */
export function detectRunner(cwd) {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm exec';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bunx';
  return 'npx';
}

/**
 * Install the pre-commit check into whichever hook system the repo uses.
 * Returns { installed, system, message }. Never throws: callers report the message.
 */
export function installHook(cwd) {
  const command = `${detectRunner(cwd)} a11y-lens check --staged`;

  const lefthookFile = LEFTHOOK_FILES.map((f) => join(cwd, f)).find((p) => existsSync(p));
  if (lefthookFile) return installLefthook(lefthookFile, command);

  if (existsSync(join(cwd, '.husky'))) return installHusky(cwd, command);

  if (existsSync(join(cwd, '.git'))) return installPlainHook(cwd, command);

  return {
    installed: false,
    system: 'none',
    message: 'no git repository found — run inside a repo, or add the hook manually',
  };
}

function installLefthook(file, command) {
  const original = readFileSync(file, 'utf8');
  if (original.includes('a11y-lens check')) {
    return { installed: false, system: 'lefthook', message: `already installed in ${file}` };
  }

  const job = (indent) =>
    `${indent}- name: a11y-lens\n${indent}  run: ${command}\n`;

  const lines = original.split('\n');
  const preCommitIndex = lines.findIndex((l) => /^pre-commit:\s*$/.test(l));

  if (preCommitIndex !== -1) {
    // Find `jobs:` within the pre-commit block (stop at the next top-level key).
    for (let i = preCommitIndex + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) break; // left the block
      const jobsMatch = lines[i].match(/^(\s+)jobs:\s*$/);
      if (jobsMatch) {
        const itemIndent = jobsMatch[1] + '  ';
        lines.splice(i + 1, 0, job(itemIndent).trimEnd());
        writeFileSync(file, lines.join('\n'));
        return { installed: true, system: 'lefthook', message: `added a11y-lens job to ${file}` };
      }
    }
    // pre-commit exists but no jobs: — unusual layout (e.g. `commands:`); don't guess.
    return {
      installed: false,
      system: 'lefthook',
      message: `${file} has a pre-commit section this tool doesn't recognize — add manually:\n\n  pre-commit:\n    jobs:\n      - name: a11y-lens\n        run: ${command}`,
    };
  }

  writeFileSync(file, `${original.trimEnd()}\n\npre-commit:\n  jobs:\n${job('    ')}`);
  return { installed: true, system: 'lefthook', message: `added pre-commit block to ${file}` };
}

function installHusky(cwd, command) {
  const file = join(cwd, '.husky', 'pre-commit');
  if (existsSync(file)) {
    const current = readFileSync(file, 'utf8');
    if (current.includes('a11y-lens check')) {
      return { installed: false, system: 'husky', message: `already installed in ${file}` };
    }
    writeFileSync(file, `${current.trimEnd()}\n${command}\n`);
    return { installed: true, system: 'husky', message: `appended to ${file}` };
  }
  writeFileSync(file, `${command}\n`);
  chmodSync(file, 0o755);
  return { installed: true, system: 'husky', message: `created ${file}` };
}

function installPlainHook(cwd, command) {
  const hooksDir = join(cwd, '.git', 'hooks');
  const file = join(hooksDir, 'pre-commit');
  if (existsSync(file)) {
    const current = readFileSync(file, 'utf8');
    if (current.includes('a11y-lens check')) {
      return { installed: false, system: 'git-hooks', message: `already installed in ${file}` };
    }
    writeFileSync(file, `${current.trimEnd()}\n${command}\n`);
    chmodSync(file, 0o755);
    return { installed: true, system: 'git-hooks', message: `appended to ${file}` };
  }
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${command}\n`);
  chmodSync(file, 0o755);
  return { installed: true, system: 'git-hooks', message: `created ${file}` };
}
