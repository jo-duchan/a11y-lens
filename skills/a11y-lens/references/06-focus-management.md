---
id: focus-management
sources: [WCAG 2.4.3, WCAG 2.4.7, WCAG 3.2.1, W3C WAI-ARIA APG dialog/disclosure patterns]
---

# Focus management & dynamic content

## Static baseline

- `outline: none` / `outline: 0` without a replacement `:focus-visible` style
- `autoFocus` on elements below the fold

## Semantic checks (what you review)

1. **Opening an overlay must move focus into it; closing must return focus to the trigger.** A modal/drawer/popover in the diff that only toggles visibility state with no `focus()` call in either direction → `error`. Focus landing on the container is acceptable (`tabIndex={-1}` + label); focus landing nowhere (document.body) is the failure.
2. **Focus trap completeness.** While a modal is open, `Tab` from the last focusable element must wrap to the first (and Shift+Tab the reverse). A "trap" implemented by `aria-hidden` on the background but with tab order still escaping → `error`.
3. **Removing the focused element.** Deleting a list item, closing a tab, dismissing a toast that currently holds focus must move focus somewhere sensible (next item, list container, heading) — otherwise focus resets to `body` and keyboard users are lost → `warning`.
4. **Route changes in SPAs.** Client-side navigation that only swaps content leaves focus and screen-reader context on the old page. New route should move focus to the new view's heading or main container, or announce via live region → `warning` when the diff adds routing.
5. **Async results need announcement.** Content that appears after a delay (search results, form submission outcome, "저장되었습니다" toast) is silent to AT unless in an `aria-live` region (`polite` for results, `assertive`/`role="alert"` for errors) → `warning`; toast components with no live region → `error`.
6. **Loading states.** Spinner-only loading (`<Spinner />` with no text, no `aria-busy`, no live announcement) → `warning`. Skeleton screens should be `aria-hidden` so AT doesn't read placeholder noise.
7. **No focus stealing.** Auto-focusing an input on page load is acceptable for single-purpose pages (login); yanking focus on timers, carousel advance, or validation-while-typing → `warning` (WCAG 3.2.1 On Focus).
8. **`scrollIntoView`/anchor jumps without focus.** Scrolling a target into view visually while focus stays behind creates divergence between sighted and keyboard experience → `warning`.

## Examples

Bad — modal with no focus contract:

```jsx
{isOpen && <div className="modal"><h2>요금제 변경</h2>…</div>}
```

Good (abridged):

```jsx
useEffect(() => {
  if (isOpen) { dialogRef.current?.focus(); }
  else { triggerRef.current?.focus(); }
}, [isOpen]);

{isOpen && (
  <div ref={dialogRef} role="dialog" aria-modal="true"
       aria-labelledby="plan-title" tabIndex={-1}>
    <h2 id="plan-title">요금제 변경</h2>…
  </div>
)}
```
