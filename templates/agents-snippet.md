<!-- a11y-lens:begin -->
## Accessibility rules (a11y-lens)

This project uses [a11y-lens](https://github.com/jo-duchan/a11y-lens) for semantic accessibility review. Staged UI changes are checked at commit time; findings with `error` severity block the commit.

When writing or modifying UI code (JSX/TSX/HTML/Vue/Svelte), apply the rule set in `node_modules/a11y-lens/rules/` — read the relevant category before implementing:

- `01-landmarks-headings.md` — document outline, one h1, no level skips, labelled landmarks
- `02-images-alt.md` — alt text that describes function in context; icon-only controls need accessible names
- `03-forms-labels.md` — placeholder is not a label; errors tied via `aria-describedby`; name matches visible label
- `04-aria-widgets.md` — prefer native elements; custom widgets implement the complete WAI-ARIA APG pattern
- `05-keyboard-interaction.md` — full APG key sets, no hover-only affordances, no keyboard traps
- `06-focus-management.md` — overlays move and return focus; async results are announced via live regions

Self-check against these categories before finishing any UI task — it is cheaper than failing the pre-commit gate.
<!-- a11y-lens:end -->
