---
id: landmarks-headings
sources: [WCAG 1.3.1, WCAG 2.4.1, WCAG 2.4.6, axe-core region/heading rules]
---

# Landmarks & heading hierarchy

## Static baseline (already caught by eslint/axe — do not re-report unless visible in the diff)

- Page content not contained in landmarks (`header`, `nav`, `main`, `footer`, `aside`, `section[aria-label]`)
- More than one `main`, duplicated `banner`/`contentinfo`
- Empty headings

## Semantic checks (what you review)

1. **Heading hierarchy must describe the document outline, not the visual design.**
   - Exactly one `h1` per page/view; levels must not skip downward (h1 → h3 with no h2 is an `error`).
   - A heading chosen for its font size rather than its outline position is a violation — check whether the level makes sense relative to surrounding headings, not whether it "looks right".
   - In SPAs, per-route views count as pages: a route component rendering only `h3`s is an `error` even if some layout file has an `h1` elsewhere — flag it as `warning` and say why (cannot see full composition).
2. **`section` needs an accessible name to be a landmark.** A bare `section` used as a styling wrapper should be a `div`; a `section` that truly groups content needs `aria-labelledby` pointing at its heading (`warning`).
3. **Landmark labels must be distinguishable.** Two `nav` elements require distinct `aria-label`s ("primary", "breadcrumb") — identical or missing labels on repeated landmarks is a `warning`.
4. **Visual titles that are not headings.** A styled `div`/`p` acting as an obvious section title (short text, followed by related content, styled prominently) should be a heading (`warning`).

## Examples

Bad — outline skips and decorative section:

```jsx
<section>            {/* no accessible name → not a landmark, just noise */}
  <h4>요금 안내</h4>  {/* previous heading was h1 → skipped to h4 */}
</section>
```

Good:

```jsx
<section aria-labelledby="pricing-title">
  <h2 id="pricing-title">요금 안내</h2>
</section>
```
