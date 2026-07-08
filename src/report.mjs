const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

const VALID_SEVERITIES = new Set(['error', 'warning']);

/** Extract a findings array from agent output, tolerating fences and prose. */
export function parseFindings(text) {
  const candidates = [];
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  candidates.push(trimmed);
  const match = trimmed.match(/\[[\s\S]*\]/);
  if (match) candidates.push(match[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed)) continue;
      return {
        findings: parsed.filter(
          (f) => f && typeof f === 'object' && typeof f.message === 'string'
            && VALID_SEVERITIES.has(f.severity),
        ),
      };
    } catch {
      /* try next candidate */
    }
  }
  return { error: 'could not parse agent output as a findings array' };
}

export function printReport(findings, { agentName } = {}) {
  if (findings.length === 0) {
    console.log(`a11y-lens: no findings ${DIM}(reviewed by ${agentName})${RESET}`);
    return;
  }
  const byFile = new Map();
  for (const f of findings) {
    const key = f.file ?? '(unknown file)';
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(f);
  }
  for (const [file, list] of byFile) {
    console.log(`\n${BOLD}${file}${RESET}`);
    list.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    for (const f of list) {
      const mark = f.severity === 'error' ? `${RED}✖ error${RESET}` : `${YELLOW}⚠ warning${RESET}`;
      const line = f.line ? `${DIM}:${f.line}${RESET}` : '';
      console.log(`  ${mark}${line}  [${f.ruleId ?? 'general'}] ${f.message}`);
      if (f.suggestion) console.log(`     ${DIM}fix: ${f.suggestion}${RESET}`);
    }
  }
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;
  console.log(
    `\na11y-lens: ${errors ? RED : ''}${errors} error(s)${RESET}, ` +
    `${warnings ? YELLOW : ''}${warnings} warning(s)${RESET} ` +
    `${DIM}(reviewed by ${agentName})${RESET}`,
  );
}

/** Exit code policy: errors gate; warnings gate only with --strict. */
export function exitCodeFor(findings, { strict } = {}) {
  const errors = findings.some((f) => f.severity === 'error');
  const warnings = findings.some((f) => f.severity === 'warning');
  if (errors) return 1;
  if (strict && warnings) return 1;
  return 0;
}
