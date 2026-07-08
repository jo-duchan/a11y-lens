---
id: aria-widgets
sources: [W3C WAI-ARIA APG patterns, WCAG 4.1.2, eslint-plugin-jsx-a11y role-* rules, axe-core aria-* rules]
---

# ARIA widget patterns

> First rule of ARIA: prefer the native element (`button`, `select`, `details`, `dialog`) — it ships the whole pattern for free. Custom widgets must implement the **complete** APG pattern; a partial pattern is worse than none because it promises behavior that isn't there.

## Static baseline

- Invalid `role` values, `aria-*` attributes not permitted for the role
- `role` requiring missing `aria-*` props (e.g. `role="checkbox"` without `aria-checked`)
- Interactive `div`/`span` with `onClick` and no role/tabindex

## Semantic checks (what you review)

For any custom widget in the diff, identify which APG pattern it is imitating, then verify the pattern is **complete** — states, properties, and relationships all present. Missing pieces of a claimed pattern are `error`.

1. **Combobox / select-like** (custom dropdown, autocomplete):
   - Trigger: `role="combobox"`, `aria-expanded` toggling, `aria-controls` → listbox id, `aria-haspopup="listbox"` where appropriate.
   - Popup: `role="listbox"`, options `role="option"` with `aria-selected`; active option tracked via `aria-activedescendant` on the combobox (or roving focus — one or the other, not both).
   - A styled `div` dropdown with only `onClick` handlers and none of the above is the classic failure → `error`.
2. **Dialog / modal**: `role="dialog"` + `aria-modal="true"`, labelled by its title. Background content must be inert or `aria-hidden` while open. (Focus behavior → rules/06.)
3. **Tabs**: `role="tablist"` / `tab` / `tabpanel`, `aria-selected` on the active tab, `aria-controls` ↔ `aria-labelledby` linkage between tab and panel.
4. **Menu**: `role="menu"`/`menuitem` is for **command menus**, not site navigation. Nav links wrapped in `role="menu"` is a misuse → `warning` (breaks expected keyboard model).
5. **Switch vs checkbox vs button**: a toggle announced as what it visually is — `role="switch"` needs `aria-checked`, not `aria-pressed`; mixing the two vocabularies is `warning`.
6. **State must live in ARIA, not only in CSS.** `className={isOpen ? 'open' : ''}` with no `aria-expanded` change means AT never hears the state change → `error` for expand/collapse triggers.
7. **`aria-hidden` on focusable content** or on an element containing focusable children → `error` (focusable but invisible to AT).
8. **Redundant/contradictory ARIA**: `role="button"` on `button`, `aria-label` duplicating identical visible text where unnecessary → `notice`-level `warning`; contradiction (label says one thing, visible text another) → follow rules/03 §2.

## Examples

Bad — half a combobox:

```jsx
<div className="select" onClick={toggle}>
  {value}
  {open && <ul>{options.map(o => <li onClick={() => pick(o)}>{o}</li>)}</ul>}
</div>
```

Good (abridged):

```jsx
<button role="combobox" aria-expanded={open} aria-controls="fruit-list"
        aria-activedescendant={activeId} onKeyDown={handleKeys}>…</button>
<ul id="fruit-list" role="listbox" hidden={!open}>
  <li id="opt-1" role="option" aria-selected={value === '사과'}>사과</li>
</ul>
```
