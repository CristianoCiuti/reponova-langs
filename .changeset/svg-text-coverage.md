---
"@reponova/lang-svg": minor
---

feat(lang-svg): multi-line `<text>` / `<tspan>` bodies, `<desc>`, `aria-label`, XML entity decoding

Substantially broadens what the SVG extractor surfaces:

- **Multi-line `<text>` bodies**: the previous `<text[^>]*>([^<]+)</text>` regex stopped at the first `<` inside the element, silently dropping every multi-line `<text>` that wraps content in `<tspan>`. The new `[\s\S]*?` matcher tolerates newlines and inner markup. `<tspan>Authentication</tspan><tspan>Service</tspan>` now becomes the single label `Authentication Service`.
- **`<title>` symbols**: `<title>` element bodies are now surfaced as section symbols (decorator `svg_title`), in addition to populating the file docstring as before. This is the most impactful change for icon libraries (e.g. simple-icons) where every glyph is a `<path>` whose only user-visible label is the brand name in `<title>`.
- **`<desc>` accessibility text**: SVG long-form descriptions are extracted (decorator `svg_desc`) — useful for hand-authored architecture diagrams that pair `<title>` with multi-sentence rationale.
- **`aria-label` attributes**: extracted from any element (decorator `svg_aria_label`). Path-only icon SVGs that delegate visible text to ARIA hints now produce graph nodes.
- **XML entity decoding**: `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&nbsp;`, numeric (`&#39;`) and hex (`&#x27;`) escapes are decoded in every extracted body (`R&amp;D Pipeline` → `R&D Pipeline`).
- **Source provenance**: every symbol's `decorators[0]` now records the source it was discovered from (`svg_text` / `svg_title` / `svg_desc` / `svg_aria_label`).

The 20-symbol-per-file cap is still applied — but now over the combined set of all four sources, so a diagram with two `<text>` and two `<desc>` blocks contributes four labels rather than only two.
