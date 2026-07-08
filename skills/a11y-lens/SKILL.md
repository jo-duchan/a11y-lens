---
name: a11y-lens
description: Semantic accessibility rules for writing or reviewing UI code — components, forms, modals, dropdowns, images, interactive elements in JSX/TSX/HTML/Vue/Svelte. Use when implementing any user-facing markup, when reviewing UI changes, or when the user asks about accessibility, WCAG, ARIA, keyboard support, or screen readers. Covers what static linters (eslint-plugin-jsx-a11y, axe-core) structurally cannot check.
---

# a11y-lens

You are applying the a11y-lens rule set: semantic accessibility review **above** the static-linter layer. Static linters check syntax ("does this `img` have an `alt`?"); you check meaning ("does this `alt` actually describe the image in context?", "is this custom dropdown's keyboard interaction complete per the WAI-ARIA APG combobox pattern?").

## How to use the rules

Before writing or reviewing UI code, read the reference file for each category the code touches. Do not guess the rules from the summaries below — the reference files carry severity guidance and good/bad examples.

| When the code involves… | Read |
|---|---|
| Page/view structure, sections, headings | [references/01-landmarks-headings.md](references/01-landmarks-headings.md) |
| Images, icons, icon-only buttons, SVG | [references/02-images-alt.md](references/02-images-alt.md) |
| Inputs, forms, validation, error messages | [references/03-forms-labels.md](references/03-forms-labels.md) |
| Custom widgets: dropdowns, modals, tabs, menus, toggles | [references/04-aria-widgets.md](references/04-aria-widgets.md) |
| Click/hover handlers, shortcuts, drag, carousels | [references/05-keyboard-interaction.md](references/05-keyboard-interaction.md) |
| Overlays, route changes, async results, toasts, loading | [references/06-focus-management.md](references/06-focus-management.md) |

Core stances that apply everywhere:

1. **Prefer native elements** (`button`, `select`, `details`, `dialog`) — they ship the complete pattern for free. A custom widget must implement the **whole** APG pattern; a partial pattern is worse than none.
2. **Placeholder is not a label. Hover is not a keyboard path. CSS state is not ARIA state.**
3. Severity discipline: `error` = clear violations (keyboard-dead interactive elements, unnamed icon-only controls, incomplete claimed ARIA patterns, unmanaged overlay focus, silenced informative images). Judgment calls are `warning`.

## Commit-time gate (CLI)

This skill has a companion CLI that runs the same rules through a headless agent at commit time:

```bash
npm install -D @a11y-lens/cli
npx a11y-lens init                 # AGENTS.md reference + hook setup instructions
npx a11y-lens check --staged       # what the pre-commit hook runs
npx a11y-lens check src/Modal.tsx  # review specific files
```

If the project has the hook installed, self-check against the rules before finishing UI work — it is cheaper than failing the gate. Repository: https://github.com/jo-duchan/a11y-lens
