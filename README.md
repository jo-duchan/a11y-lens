# a11y-lens

> **Package** [`@a11y-lens/cli`](https://www.npmjs.com/package/@a11y-lens/cli) · **CLI** `a11y-lens` · **Skill** `npx skills add jo-duchan/a11y-lens`

**AI-powered semantic accessibility linter.** Reviews what static linters can't see — using the AI coding agent you already have (Claude Code, Codex, or Cursor).

Static linters check **syntax**: *does this `img` have an `alt`?*
a11y-lens checks **semantics**: *does this `alt` actually describe the image? Is this custom dropdown's keyboard interaction complete per the WAI-ARIA combobox pattern? Does the modal return focus to its trigger?*

```
$ git commit -m "add plan selector"
a11y-lens: reviewing 1 file(s) with claude…

src/PlanSelect.jsx
  ✖ error:23  [aria-widgets] Custom dropdown is a div with onClick only — no combobox
     role, no aria-expanded, no listbox/option semantics. AT users get a plain text node.
     fix: use role="combobox" + aria-expanded + role="listbox"/"option", or a native <select>
  ✖ error:23  [keyboard-interaction] Dropdown cannot be operated by keyboard: no ArrowDown/
     ArrowUp/Enter/Escape handling per the APG combobox pattern.
     fix: add onKeyDown implementing the APG combobox key set

a11y-lens: 2 error(s), 0 warning(s) (reviewed by claude)
husky - pre-commit hook exited with code 1
```

## How it works

1. Collects the **staged** UI files (`.jsx`, `.tsx`, `.html`, `.vue`, `.svelte`, …) and their diffs.
2. Sends them — together with a distilled rule set (`skills/a11y-lens/references/*.md`, drawn from WAI-ARIA APG, WCAG 2.2, eslint-plugin-jsx-a11y and axe-core coverage) — to a headless agent CLI: `claude -p`, `codex exec`, or `cursor-agent -p`, whichever is installed.
3. Parses the structured findings and gates the commit on `error` severity. Warnings report but never block (unless `--strict`).

**Infrastructure never blocks a commit.** No agent CLI, no network, agent crash → a11y-lens warns and exits 0. Only real accessibility findings gate.

**…but a skipped check does not pass for a clean one.** Exiting 0 means your hook runner shows the same ✔️ either way, so when a staged check could not review a file — the agent timed out or failed, its output could not be parsed, or the file was dropped for the prompt size budget — a11y-lens records it as *pending*. The next check warns about it, and `a11y-lens check --pending` reviews it later. See [Skipped checks](#skipped-checks).

## It samples; it does not audit

a11y-lens is an AI reviewer, not a deterministic linter. The same files reviewed twice can return different findings — even zero on a run that flagged issues a moment earlier. Read the output with that in mind:

- **A clean run ≠ zero issues.** It means nothing surfaced *in that sample*, not that the code is fully accessible.
- **Findings don't converge to zero.** Re-running to "clear" every last warning is the wrong mental model; a later run may raise something new.
- **The intended job is gating `--staged` diffs** — catching problems as they're *introduced*. It is not a full-audit tool for an existing codebase; for that, pair it with a human accessibility review.

This is deliberate: only clear `error`-severity violations gate and warnings never block, precisely because AI output varies run to run. (This note belongs here, in the tool's own README — not in the `AGENTS.md` rules block that `init` injects into a consuming project, which is reserved for the accessibility rules themselves.)

## Levels: what gets checked, and what gets shown

Not every project needs every check. Each check in the rule set is tagged by who it helps:

- **`core`**: checks that help everyone. They cover accessible names on icon-only controls, labels that are not placeholders, names that match the visible label, autocomplete on identity fields, full keyboard operation, and focus that is moved, returned and never lost.
- **`full`**: the core checks plus the ones that are specific to screen readers. They cover headings and landmarks, alt text, complete ARIA patterns, errors tied to their fields, and live-region announcements for async results and loading.

A `full` review is a superset of a `core` one, so code written to `full` passes `core`.

Set the level for the whole team in the repository:

```json
// a11y-lens.config.json (or the "a11y-lens" field of package.json)
{ "level": "core", "report": "errors" }
```

| Setting | Values | Default |
|---|---|---|
| `level` | `core`: only `[core]` checks are sent to the agent. `full`: all checks. | `full` |
| `report` | `errors`: print errors, and say how many warnings were hidden. `all`: print everything. | `all` |

The defaults are what earlier versions did, so upgrading changes nothing until a project opts in. `A11Y_LENS_LEVEL` and `A11Y_LENS_REPORT` override the file for one run. `--strict` always prints warnings, because it makes them fail the commit. An unknown value is warned about and replaced by the default.

These levels are not WCAG's A/AA/AAA. They sort checks by who benefits, not by conformance level.

## Install

a11y-lens has two layers — install either or both:

**Write time (agent skill).** Teaches your coding agent the rules so UI code is accessible *before* the hook ever runs. [The skills CLI](https://skills.sh) installs it for Claude Code, Codex, Cursor, and 60+ other agents:

```bash
npx skills add jo-duchan/a11y-lens
```

**Commit time (git hook gate):**

```bash
npm install -D @a11y-lens/cli   # or pnpm add -D / yarn add -D
npx a11y-lens init
```

`init` installs the pre-commit hook for you — it detects lefthook (`lefthook.yml`), husky (`.husky/`), or plain `.git/hooks`, picks your package manager's runner (`pnpm exec` / `yarn` / `bunx` / `npx`), and adds the check idempotently. It also injects a rules reference into your `AGENTS.md` (a lightweight fallback for agents without skills support). Use `--no-hook` to skip hook installation.

Example (lefthook):

```yaml
pre-commit:
  jobs:
    - name: a11y-lens
      run: npx a11y-lens check --staged
```

## Usage

```bash
a11y-lens check --staged           # what the git hook runs
a11y-lens check src/Modal.tsx      # review specific files
a11y-lens check --staged --strict  # warnings also fail
a11y-lens check --staged --agent codex
a11y-lens check --pending          # review files an earlier check skipped
a11y-lens rules                    # list rule categories
```

Escape hatches: `A11Y_LENS_SKIP=1 git commit …` or `git commit --no-verify`.

| Environment | Effect |
|---|---|
| `A11Y_LENS_AGENT` | same as `--agent` |
| `A11Y_LENS_MODEL` | model passed to `claude` |
| `A11Y_LENS_TIMEOUT_MS` | agent timeout in milliseconds (default `180000`) |
| `A11Y_LENS_LEVEL` | `core` or `full` for this run, over the project's setting |
| `A11Y_LENS_REPORT` | `errors` or `all` for this run, over the project's setting |
| `A11Y_LENS_SKIP=1` | skip the check entirely |

## Skipped checks

A staged check records a file as pending when it could not review it:

| Why the file was not reviewed | Recorded? |
|---|---|
| Agent timed out, crashed, or exited non-zero (including logged out or out of quota) | yes |
| Agent output could not be parsed as findings | yes |
| Dropped because the prompt size budget was spent | yes |
| `A11Y_LENS_SKIP=1`, no agent CLI installed, file over 48KB, no UI files staged | no: deliberate, or it would be skipped again |

An entry is cleared when `check --pending` reviews it, or when a later `check --staged` in the same worktree reviews the very same staged content (a commit that was aborted and retried). If the skipped commit landed, its change is no longer in the next diff, so only `--pending` clears it. `--pending` reviews the content that was **staged at the time**, with its staged diff. That way it reports on the skipped change, not on the whole file as it is now. It works even after the file has changed or its worktree is gone. Each skipped check is reviewed in its own agent call. Anything that times out or is dropped again stays pending.

**Layout (public contract, version 1).** Other tools may read this, for example a hook that reminds an agent to run `--pending`:

```
<git rev-parse --git-common-dir>/a11y-lens/pending/<sha1>.json
{ "version": 1, "worktree": "/abs/path", "path": "src/A.tsx", "blob": "<index sha>",
  "diff": "<staged diff>", "reason": "agent failed: …", "at": "2026-09-23T06:00:00.000Z" }
```

A non-empty directory means something was not reviewed. Any change to this layout bumps `version`. A record this version cannot read (another version wrote it, or it is damaged) is reported and never cleared automatically. Once it has been dealt with, delete the file by hand.

## Rule set

One markdown file per category in `skills/a11y-lens/references/`, consumed by both the skill and the CLI. Each separates the **static baseline** (what eslint/axe already catch — not re-reported) from the **semantic checks** this tool exists for.

| Category | Semantic checks (examples) |
|---|---|
| `01-landmarks-headings` | outline describes the document, not the visual design; one `h1`; labelled landmarks |
| `02-images-alt` | `alt` describes function in context; decorative silenced, informative never; icon-only controls named by action |
| `03-forms-labels` | placeholder ≠ label; errors tied via `aria-describedby`; accessible name matches visible label |
| `04-aria-widgets` | claimed APG patterns must be **complete** — half a combobox is worse than none; state in ARIA, not just CSS |
| `05-keyboard-interaction` | full APG key sets; no hover-only affordances; no keyboard traps |
| `06-focus-management` | overlays move focus in and return it; async results announced via live regions; SPA route changes handled |

Rules are plain markdown — tune them for your project by editing the files, no code changes needed.

## Why commit-time AI review is cheap now

In AI-native workflows the entity blocked at pre-commit is usually **an agent, not a human**. A 10–30 second semantic review is a fine price when the committer can read the findings, fix them, and retry without getting annoyed.

## Requirements

- Node ≥ 18, zero runtime dependencies
- One of: [Claude Code](https://claude.com/claude-code) (`claude`), [Codex CLI](https://github.com/openai/codex) (`codex`), [Cursor CLI](https://cursor.com/cli) (`cursor-agent`), logged in

## License

MIT © Duchan Jo — see [NOTICE](./NOTICE) for rule-set attributions (eslint-plugin-jsx-a11y, axe-core, W3C WAI-ARIA APG, WCAG 2.2).
