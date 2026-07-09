import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const UI_EXTENSIONS = new Set([
  '.jsx', '.tsx', '.html', '.htm', '.vue', '.svelte', '.astro', '.mdx',
]);
// .js/.ts are included only when their content looks like markup (JSX, template strings with tags).
const MAYBE_UI_EXTENSIONS = new Set(['.js', '.ts', '.mjs', '.cjs']);

const MAX_FILE_BYTES = 48_000;

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...options });
}

function extensionOf(path) {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot).toLowerCase();
}

function looksLikeUI(content) {
  // JSX/HTML-ish: an opening tag followed by attributes, `/>` or `>`.
  return /<([a-z][\w-]*|[A-Z]\w*)(\s[^<>]*)?\/?>/.test(content);
}

/**
 * Collect staged files that plausibly contain UI markup.
 * Returns [{ path, content, diff, skipped? }]
 */
export function collectStagedUIFiles() {
  let names;
  try {
    names = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
      .split('\n')
      .filter(Boolean);
  } catch {
    return { files: [], error: 'not a git repository (or git unavailable)' };
  }

  const files = [];
  for (const path of names) {
    const ext = extensionOf(path);
    const isUI = UI_EXTENSIONS.has(ext);
    const isMaybeUI = MAYBE_UI_EXTENSIONS.has(ext);
    if (!isUI && !isMaybeUI) continue;

    let content;
    try {
      content = git(['show', `:${path}`], { maxBuffer: 10 * 1024 * 1024 });
    } catch {
      continue; // deleted between index and now, submodule, etc.
    }
    if (isMaybeUI && !looksLikeUI(content)) continue;
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
      files.push({ path, skipped: `larger than ${MAX_FILE_BYTES / 1000}KB` });
      continue;
    }

    let diff = '';
    try {
      diff = git(['diff', '--cached', '--unified=3', '--', path]);
    } catch {
      /* diff is best-effort context */
    }
    files.push({ path, content, diff });
  }
  return { files };
}

/** Read explicit file paths from the working tree (non-staged mode). */
export function collectPathArgs(paths) {
  const files = [];
  for (const path of paths) {
    let content;
    try {
      // readFileSync (not a `cat` shell-out): portable to Windows, and filenames
      // that start with `-` are never mistaken for flags.
      content = readFileSync(path, 'utf8');
    } catch {
      // An unreadable argument that contains whitespace is almost always several
      // paths the shell never word-split (e.g. an unquoted joined variable in zsh)
      // delivered as one argument. Surface that instead of silently skipping.
      const skipped = /\s/.test(path)
        ? 'looks like several paths passed as one argument — pass each file as a separate, unquoted argument (in zsh, check array/glob expansion)'
        : 'unreadable';
      files.push({ path, skipped });
      continue;
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
      files.push({ path, skipped: `larger than ${MAX_FILE_BYTES / 1000}KB` });
      continue;
    }
    files.push({ path, content, diff: '' });
  }
  return { files };
}
