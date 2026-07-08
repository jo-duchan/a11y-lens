import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', 'skills', 'a11y-lens', 'references',
);
const MAX_TOTAL_BYTES = 160_000;

export function loadRules() {
  return readdirSync(RULES_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => readFileSync(join(RULES_DIR, name), 'utf8'))
    .join('\n\n---\n\n');
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
export function buildPrompt(files) {
  const rules = loadRules();
  const included = [];
  const dropped = [];
  let budget = MAX_TOTAL_BYTES;

  for (const file of files) {
    const block = [
      `### FILE: ${file.path}`,
      '```',
      numbered(file.content),
      '```',
      file.diff ? `#### Staged diff for ${file.path} (focus your review here)\n\`\`\`diff\n${file.diff}\n\`\`\`` : '',
    ].join('\n');
    const size = Buffer.byteLength(block, 'utf8');
    if (size > budget) {
      dropped.push(file.path);
      continue;
    }
    budget -= size;
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
  "ruleId": "one of: landmarks-headings | images-alt | forms-labels | aria-widgets | keyboard-interaction | focus-management",
  "severity": "error" | "warning",
  "message": "what is wrong and why it matters, one or two sentences",
  "suggestion": "the concrete fix, one sentence or a short code hint"
}

Severity discipline: "error" only for clear violations named as error in the rules (keyboard-dead interactive elements, missing accessible names on icon-only controls, incomplete claimed ARIA patterns, focus not managed on overlays, informative images silenced). Judgment calls are "warning". If the code is clean, respond with [].`;

  return { prompt, dropped };
}
