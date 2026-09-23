import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', 'skills', 'a11y-lens', 'references',
);
const MAX_TOTAL_BYTES = 160_000;

// Named per level so the prompt never cites a check the level left out — an agent told that
// "incomplete claimed ARIA patterns" are errors reviews ARIA patterns whether or not they are listed.
const SEVERITY_EXAMPLES = {
  core: 'keyboard-dead interactive elements, missing accessible names on icon-only controls, focus not managed on overlays',
  full: 'keyboard-dead interactive elements, missing accessible names on icon-only controls, incomplete claimed ARIA patterns, focus not managed on overlays, informative images silenced',
};

const LEVEL_TAG = /^`\[(core|full)\]`/;

/**
 * One rule file cut down to a level. `full` is the file as written. `core` keeps the numbered
 * semantic checks and the example subsections tagged `[core]`, and drops a file with none — so what
 * the agent is shown is only what it is asked to check. Numbers are kept, because other files refer
 * to checks by number ("rules/03 §2").
 */
export function filterRule(text, level) {
  if (level === 'full') return text;
  const sections = text.split(/(?=^## )/m);
  let kept = 0;
  const out = sections.map((section) => {
    if (section.startsWith('## Semantic checks')) {
      const [intro, ...items] = section.split(/(?=^\d+\. )/m);
      const chosen = items.filter((item) => item.replace(/^\d+\. /, '').match(LEVEL_TAG)?.[1] === level);
      kept += chosen.length;
      return intro + chosen.join('');
    }
    if (section.startsWith('## Examples')) {
      const [intro, ...subsections] = section.split(/(?=^### )/m);
      const chosen = subsections.filter((sub) => sub.replace(/^### /, '').match(LEVEL_TAG)?.[1] === level);
      return chosen.length ? intro + chosen.join('') : '';
    }
    return section;
  });
  return kept === 0 ? null : out.join('');
}

/** The rule files at `level`, joined, and the ids of the categories that survived. */
export function loadRules(level = 'full') {
  const files = readdirSync(RULES_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => filterRule(readFileSync(join(RULES_DIR, name), 'utf8'), level))
    .filter((text) => text !== null);
  const ids = files.map((text) => text.match(/^id: (\S+)$/m)?.[1]).filter(Boolean);
  return { text: files.join('\n\n---\n\n'), ids };
}

function numbered(content) {
  return content
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(4)}: ${line}`)
    .join('\n');
}

/**
 * Assemble the review prompt. Files over the total budget are dropped
 * (caller already reported per-file skips); we report drops via the return value.
 */
export function buildPrompt(files, { level = 'full' } = {}) {
  const { text: rules, ids } = loadRules(level);
  const included = [];
  const dropped = [];
  let budget = MAX_TOTAL_BYTES;

  for (const file of files) {
    const fileBlock = [`### FILE: ${file.path}`, '```', numbered(file.content), '```'].join('\n');
    const withDiff = file.diff
      ? `${fileBlock}\n#### Staged diff for ${file.path} (focus your review here)\n\`\`\`diff\n${file.diff}\n\`\`\``
      : fileBlock;
    // Content is capped at 48KB and a diff is not, so a rewrite can make one file's block larger
    // than the whole budget — dropped every time, including on every `--pending` re-check. Without
    // its diff it always fits an empty budget, so it is reviewed whole rather than never.
    const block = [withDiff, fileBlock].find((b) => Buffer.byteLength(b, 'utf8') <= budget);
    if (!block) {
      dropped.push(file.path);
      continue;
    }
    budget -= Buffer.byteLength(block, 'utf8');
    included.push(block);
  }

  const prompt = `You are a11y-lens, a semantic accessibility reviewer. You review UI code against the rule set below. You are the layer ABOVE static linters: do not report what eslint-plugin-jsx-a11y or axe-core would already catch unless it is listed under "Semantic checks". Focus on meaning, completeness of patterns, and context — the things attribute-presence checks cannot see.

## Rule set

${rules}

## Code under review

Each file is shown with line numbers ("NNNN: code"). When a staged diff is provided, findings should concern changed or directly affected code; use the full file only for context.

${included.join('\n\n')}

## Output format

Respond with ONLY a JSON array — no prose, no markdown fences. Each finding:
{
  "file": "path as given above",
  "line": <number from the line-number prefix>,
  "ruleId": "one of: ${ids.join(' | ')}",
  "severity": "error" | "warning",
  "message": "what is wrong and why it matters, one or two sentences",
  "suggestion": "the concrete fix, one sentence or a short code hint"
}

Severity discipline: "error" only for clear violations named as error in the rules (${SEVERITY_EXAMPLES[level]}). Judgment calls are "warning". ${level === 'core' ? 'Check only the rules above; this project has chosen not to review the others, so do not report them. ' : ''}If the code is clean, respond with [].`;

  return { prompt, dropped };
}
