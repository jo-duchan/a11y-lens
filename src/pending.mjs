// Pending reviews: staged files a check could not review, kept so the skip is visible later.
//
// A skipped check exits 0 so a commit is never blocked by infrastructure — which also makes it look
// exactly like a clean one. Each file it failed to review is recorded here, and stays until a later
// run actually reviews it (`check --staged` on the same path, or `check --pending`).
//
// Layout (a public contract — other tools read it; bump PENDING_VERSION on any change):
//   <git-common-dir>/a11y-lens/pending/<sha1(worktree + NUL + path)>.json
//   { version, worktree, path, blob, diff, reason, at }
//
// - One file per entry: parallel commits in several worktrees record at the same moment, and a
//   single shared file would lose one of them. Each is written to a temp file and renamed, so a
//   reader never sees half an entry (untested: the race cannot be staged deterministically).
// - The common dir, so an entry recorded in a worktree is still visible after that worktree is gone.
// - `blob` is the index object that was staged. It lives in the shared object store, so the exact
//   content that went unreviewed can still be read after the worktree is removed or the file edited.
// - `diff` is the staged diff, so a re-check reviews the change rather than the whole file and does
//   not report pre-existing issues as if the skipped commit introduced them.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PENDING_VERSION = 1;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 10 * 1024 * 1024 });
}

/** Absolute pending directory, or null outside a git repository. */
export function pendingDir(cwd = process.cwd()) {
  try {
    const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd).trim();
    return join(common, 'a11y-lens', 'pending');
  } catch {
    return null;
  }
}

function worktreeOf(cwd) {
  return git(['rev-parse', '--show-toplevel'], cwd).trim();
}

function entryName(worktree, path) {
  return `${createHash('sha1').update(`${worktree}\0${path}`).digest('hex')}.json`;
}

/**
 * Record staged files that were not reviewed. `files` are staged entries ({ path, diff }).
 * Returns { recorded } or { error } — never throws, because a failure here must not block a commit.
 */
export function recordPending(files, reason, { cwd = process.cwd(), now = new Date() } = {}) {
  if (files.length === 0) return { recorded: 0 };
  try {
    const dir = pendingDir(cwd);
    if (!dir) return { error: 'not a git repository' };
    const worktree = worktreeOf(cwd);
    mkdirSync(dir, { recursive: true });
    const at = now.toISOString();
    for (const file of files) {
      let blob = null;
      try {
        blob = git(['rev-parse', `:${file.path}`], worktree).trim();
      } catch {
        /* not in the index (non-staged run); the working-tree path is the only locator */
      }
      const entry = { version: PENDING_VERSION, worktree, path: file.path, blob, diff: file.diff ?? '', reason, at };
      const target = join(dir, entryName(worktree, file.path));
      const temp = `${target}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(entry));
      renameSync(temp, target);
    }
    return { recorded: files.length };
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
}

/** All readable entries, each with its file name. Unreadable or foreign-version files are counted, not returned. */
export function listPending(cwd = process.cwd()) {
  const dir = pendingDir(cwd);
  if (!dir) return { entries: [], unreadable: 0 };
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return { entries: [], unreadable: 0 };
  }
  const entries = [];
  let unreadable = 0;
  for (const name of names) {
    try {
      const raw = readFileSync(join(dir, name), 'utf8');
      const entry = JSON.parse(raw);
      if (entry?.version !== PENDING_VERSION || typeof entry.path !== 'string') {
        unreadable++;
        continue;
      }
      entries.push({ name, raw, entry });
    } catch {
      unreadable++;
    }
  }
  return { entries, unreadable };
}

/** Drop entries for `paths` in the current worktree — called once a staged run reviewed them. */
export function clearReviewed(paths, cwd = process.cwd()) {
  try {
    const dir = pendingDir(cwd);
    if (!dir) return;
    const worktree = worktreeOf(cwd);
    for (const path of paths) rmSync(join(dir, entryName(worktree, path)), { force: true });
  } catch {
    /* best effort: a stale entry is re-checked later, never lost */
  }
}

/**
 * Drop an entry read earlier, but only if it has not been re-recorded since — a commit that skipped
 * the same path while `--pending` ran has content this run did not review.
 */
export function clearEntry({ name, raw }, cwd = process.cwd()) {
  const dir = pendingDir(cwd);
  if (!dir) return;
  const file = join(dir, name);
  try {
    if (readFileSync(file, 'utf8') === raw) rmSync(file, { force: true });
  } catch {
    /* already gone */
  }
}

/**
 * The content an entry stands for: the staged blob, else the working-tree file.
 * Returns { content } or { gone: reason }.
 */
export function contentOf(entry, cwd = process.cwd()) {
  if (entry.blob) {
    try {
      return { content: git(['cat-file', '-p', entry.blob], cwd) };
    } catch {
      /* pruned by gc — fall through to the working tree */
    }
  }
  try {
    return { content: readFileSync(join(entry.worktree, entry.path), 'utf8') };
  } catch {
    return { gone: 'neither the staged blob nor the file exists any more' };
  }
}
