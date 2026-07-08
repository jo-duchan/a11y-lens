---
id: images-alt
sources: [WCAG 1.1.1, eslint-plugin-jsx-a11y alt-text/img-redundant-alt, axe-core image-alt]
---

# Images & text alternatives

## Static baseline

- `img` missing `alt` attribute entirely
- `alt` containing "image", "picture", "photo", "이미지", "사진" (redundant)
- `input[type=image]`, `area`, `object` without text alternative

## Semantic checks (what you review)

1. **Does the `alt` actually describe the image's function or content in context?**
   - `alt="banner"`, `alt="icon"`, `alt="img_03"`, filename-derived alt → `error`. These pass static linters and fail humans.
   - An image inside a link: alt must describe the **destination/action**, not the picture ("에이닷 전화 다운로드", not "스마트폰 그림") — mismatch is `warning`.
2. **Decorative images must be explicitly silenced**, not given filler alt. Purely decorative → `alt=""` (and `aria-hidden="true"` for inline SVG). Filler like `alt="장식"` is `warning`.
3. **Informative images must not be silenced.** `alt=""` on an image that plainly carries information (chart, badge with a number, screenshot referenced by the copy) is an `error`.
4. **Icon-only interactive elements.** A button/link whose only content is an icon (SVG, icon font, emoji) needs an accessible name (`aria-label` or visually-hidden text). Check the name describes the **action** ("닫기", not "X 아이콘"). Missing → `error`; vague → `warning`.
5. **Text baked into images** (event banners with dates/prices in pixels) — the alt or adjacent text must carry the same information; otherwise `warning`.
6. **CSS background-images conveying meaning** have no alt channel at all — if the diff shows meaningful content moved into a background-image, flag `warning` with the visually-hidden-text remedy.

## Examples

Bad — passes static linting, fails semantically:

```jsx
<a href="/download"><img src="/hero-phone.png" alt="phone image" /></a>
<button><CloseIcon /></button>
```

Good:

```jsx
<a href="/download"><img src="/hero-phone.png" alt="에이닷 전화 앱 다운로드" /></a>
<button aria-label="닫기"><CloseIcon aria-hidden="true" /></button>
```
