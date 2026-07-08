---
type: rules
topics: [meta, conventions]
status: living
---

# a11y-lens — AGENTS.md (Common Rules)

## WHAT

a11y-lens is an **AI-powered semantic accessibility linter**. It reviews UI code changes with an AI coding agent (Claude Code, Codex, or Cursor) against a distilled rule set from established accessibility standards — and catches what static linters structurally cannot.

Static linters (eslint-plugin-jsx-a11y, axe-core, Biome a11y rules) check **syntax**: "does this `img` have an `alt` attribute?" a11y-lens checks **semantics**: "does this `alt` actually describe the image?", "is this combobox's keyboard interaction complete per the WAI-ARIA APG pattern?", "does this `aria-label` match the visible text?"

### Two consumption surfaces, one rule set

1. **Write time** — an agent skill (`skills/a11y-lens/SKILL.md`, installable via `npx skills add jo-duchan/a11y-lens`) teaches interactive agents the rules *while writing* UI code. `a11y-lens init` additionally injects a lightweight rules reference into the consuming project's `AGENTS.md` as a fallback.
2. **Commit time** — `a11y-lens check --staged` runs from a git hook (lefthook, husky, or plain `.git/hooks`), sends the staged UI diff plus the relevant rules to a headless agent CLI, and gates the commit on `error`-severity findings.

## WHY

- Accessibility regressions slip through because static rules only see attributes, not meaning.
- In AI-native workflows, the entity blocked at pre-commit is usually an agent, not a human — so a 10–30s semantic review at commit time is cheap and the feedback loop is immediate.
- Rules live as plain markdown (`rules/*.md`): reviewable, versionable, and consumable by any agent that reads `AGENTS.md`.

## Design principles

1. **Never break a commit for infrastructure reasons.** No agent CLI installed, no network, agent error → warn and pass (exit 0). Only genuine `error`-severity findings gate.
2. **Deterministic-ish gating.** AI output varies run to run. Only clear rule violations are `error`; judgment calls are `warning` and never block (unless `--strict`).
3. **Zero runtime dependencies.** Plain Node ESM (≥18). The heavy lifting is delegated to the agent CLI the user already has.
4. **Rules are data, not code.** Adding or tuning a check means editing a markdown file in `skills/a11y-lens/references/`, never the CLI. The skill and the CLI consume the same files.
5. **Agent-agnostic.** Auto-detects `claude` → `codex` → `cursor-agent`, overridable with `--agent`. No agent-specific behavior in the rules themselves.

## Layout

```
bin/a11y-lens.mjs               # CLI entry: check | init | rules
src/staged.mjs                  # git staged-file collection
src/agent.mjs                   # agent CLI detection + headless invocation
src/prompt.mjs                  # prompt assembly from rules + files
src/report.mjs                  # findings parsing + terminal report + exit code
skills/a11y-lens/SKILL.md       # agent skill (skills.sh format, progressive disclosure)
skills/a11y-lens/references/    # the distilled rule set (numbered by category) — single source
templates/                      # AGENTS.md snippet injected by `init`
test/fixtures/                  # intentionally broken components for smoke tests
```

## Conventions for working on this repo

- Plain JavaScript ESM only — no TypeScript, no build step, no runtime deps.
- Rule files follow the shared format: frontmatter (`id`, `sources`), then `## Static baseline` (what existing linters already catch — do not duplicate their job) and `## Semantic checks` (what a11y-lens exists for), with severity guidance and good/bad examples.
- Rule content is distilled from eslint-plugin-jsx-a11y (MIT), axe-core rule docs (MPL-2.0), and the W3C WAI-ARIA Authoring Practices Guide. Keep attributions in `NOTICE` current when adding rules.
- Do not commit or push unless explicitly asked. Do not merge PRs.
- Verify changes by running the CLI against `test/fixtures/` before declaring done.
