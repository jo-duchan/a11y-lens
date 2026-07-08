# a11y-lens

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

## Install

a11y-lens has two layers — install either or both:

**Write time (agent skill).** Teaches your coding agent the rules so UI code is accessible *before* the hook ever runs. [The skills CLI](https://skills.sh) installs it for Claude Code, Codex, Cursor, and 60+ other agents:

```bash
npx skills add jo-duchan/a11y-lens
```

**Commit time (git hook gate):**

```bash
npm install -D @joduchan/a11y-lens   # or pnpm add -D / yarn add -D
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
a11y-lens rules                    # list rule categories
```

Escape hatches: `A11Y_LENS_SKIP=1 git commit …` or `git commit --no-verify`.

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
