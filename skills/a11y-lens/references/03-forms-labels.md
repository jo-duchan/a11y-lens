---
id: forms-labels
sources: [WCAG 1.3.1, WCAG 3.3.1, WCAG 3.3.2, WCAG 4.1.2, eslint-plugin-jsx-a11y label-has-associated-control, axe-core label/select-name]
---

# Forms, labels & error states

## Static baseline

- Form control without any programmatic label (`label[for]`, wrapping `label`, `aria-label`, `aria-labelledby`)
- `label` not associated with a control

## Semantic checks (what you review)

1. **Placeholder is not a label.** A control whose only "label" is `placeholder` is an `error` — it disappears on input and has no reliable AT exposure. Check the diff for inputs that visually rely on placeholder alone.
2. **The accessible name must match the visible label.** If a visible text label says "휴대폰 번호" but `aria-label="phone"`, voice-control users cannot target it (WCAG 2.5.3 Label in Name) → `warning`.
3. **Errors must be programmatically tied to their field.** Rendering an error message as a sibling `<p className="error">` with no `aria-describedby` on the input and no `aria-invalid` is `error` when the diff introduces validation UI. A live-updating error summary should use `role="alert"` or `aria-live="assertive"` — but only one, not both stacked.
4. **Required and disabled semantics.** Visually-marked required fields (asterisk, "필수") need `required` or `aria-required="true"` (`warning`). A visually "disabled" button that is actually a styled `div` or keeps focus without `disabled`/`aria-disabled` misleads AT → `warning`.
5. **Grouped controls need a group name.** Radio sets / related checkboxes introduced without `fieldset`+`legend` (or `role="radiogroup"` + `aria-labelledby`) → `warning`: each option is announced with no question attached.
6. **Autocomplete on identity fields.** Login/checkout fields for name, email, tel, address should carry `autocomplete` tokens (WCAG 1.3.5) → `warning` when the diff adds such fields bare.

## Examples

Bad:

```jsx
<input placeholder="이메일" value={email} onChange={...} />
{error && <p className="error">이메일 형식이 아닙니다</p>}
```

Good:

```jsx
<label htmlFor="email">이메일</label>
<input id="email" type="email" autoComplete="email" value={email}
       aria-invalid={!!error} aria-describedby={error ? "email-error" : undefined} />
{error && <p id="email-error" role="alert">이메일 형식이 아닙니다</p>}
```
