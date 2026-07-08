---
id: keyboard-interaction
sources: [WCAG 2.1.1, WCAG 2.1.2, W3C WAI-ARIA APG keyboard patterns, eslint-plugin-jsx-a11y click-events-have-key-events]
---

# Keyboard interaction

## Static baseline

- `onClick` on non-interactive elements without `onKeyDown`/`onKeyUp`
- `tabIndex` greater than 0
- Interactive element with `tabIndex={-1}` and no programmatic focus management

## Semantic checks (what you review)

1. **Every pointer interaction needs a keyboard equivalent — the right one.** Adding `onKeyDown` that only handles Enter on a `div` "button" is incomplete: native buttons fire on Enter **and** Space. Check the handler actually implements the expected key set, not just any key (`error` if a claimed interactive element is keyboard-dead, `warning` if the key set is partial).
2. **Widget key sets must match the APG pattern being imitated:**
   - Combobox/listbox: `ArrowDown`/`ArrowUp` move the active option, `Enter` selects, `Escape` closes, `Home`/`End` jump, printable characters typeahead (typeahead is `warning`-level, the rest `error` if absent).
   - Tabs: `ArrowLeft`/`ArrowRight` between tabs (roving tabindex), `Tab` leaves the tablist into the panel.
   - Dialog: `Escape` closes; `Tab` cycles inside (focus trap — see rules/06).
   - Menu: arrows navigate, `Escape` closes and returns focus to the trigger.
3. **Hover-only affordances.** Content or controls revealed only on `:hover`/`onMouseEnter` with no focus/keyboard path (tooltips, hover menus, card action buttons) → `error`: keyboard users can never reach them. Also flag `onMouseDown`-only handlers (skips keyboard AND breaks click-drag expectations).
4. **No keyboard traps.** Custom key handling that `preventDefault()`s Tab without providing an exit is an `error` (WCAG 2.1.2). Legitimate traps (modal dialogs) must be escapable via `Escape`.
5. **Scroll/drag-only interactions** (carousels, sliders, drag-to-reorder) need button or keyboard alternatives → `warning`.
6. **Global shortcuts on printable keys** without a modifier or an off-switch collide with AT and text input → `warning` (WCAG 2.1.4).

## Examples

Bad — mouse-only reveal:

```jsx
<div onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
  요금제 비교 {show && <button onClick={openDetail}>자세히</button>}
</div>
```

Good:

```jsx
<div onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
  요금제 비교 <button onClick={openDetail} className={visible ? '' : 'sr-until-focus'}>자세히</button>
</div>
```
