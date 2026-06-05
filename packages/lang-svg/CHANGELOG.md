# @reponova/lang-svg

## 0.3.0

### Minor Changes

- 11c3541: feat(lang-svg): multi-line `<text>` / `<tspan>` bodies, `<desc>`, `aria-label`, XML entity decoding

  Substantially broadens what the SVG extractor surfaces:

  - **Multi-line `<text>` bodies**: the previous `<text[^>]*>([^<]+)</text>` regex stopped at the first `<` inside the element, silently dropping every multi-line `<text>` that wraps content in `<tspan>`. The new `[\s\S]*?` matcher tolerates newlines and inner markup. `<tspan>Authentication</tspan><tspan>Service</tspan>` now becomes the single label `Authentication Service`.
  - **`<title>` symbols**: `<title>` element bodies are now surfaced as section symbols (decorator `svg_title`), in addition to populating the file docstring as before. This is the most impactful change for icon libraries (e.g. simple-icons) where every glyph is a `<path>` whose only user-visible label is the brand name in `<title>`.
  - **`<desc>` accessibility text**: SVG long-form descriptions are extracted (decorator `svg_desc`) — useful for hand-authored architecture diagrams that pair `<title>` with multi-sentence rationale.
  - **`aria-label` attributes**: extracted from any element (decorator `svg_aria_label`). Path-only icon SVGs that delegate visible text to ARIA hints now produce graph nodes.
  - **XML entity decoding**: `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&nbsp;`, numeric (`&#39;`) and hex (`&#x27;`) escapes are decoded in every extracted body (`R&amp;D Pipeline` → `R&D Pipeline`).
  - **Source provenance**: every symbol's `decorators[0]` now records the source it was discovered from (`svg_text` / `svg_title` / `svg_desc` / `svg_aria_label`).

  The 20-symbol-per-file cap is still applied — but now over the combined set of all four sources, so a diagram with two `<text>` and two `<desc>` blocks contributes four labels rather than only two.

### Patch Changes

- 0fc86ae: Add `simple/` + `medium/` + `complex/` test fixture tiers, in line with section 8.7 of the integration plan, bringing the three Wave-0 plugins to the same coverage shape as `@reponova/lang-typescript`. No runtime behaviour change.

  - `lang-python`: hand-authored `simple/cli.py` and `medium/cache.py`, plus a 17-file verbatim snapshot of `pallets/click` 8.4.1 (BSD-3-Clause) under `complex/click-8.4.1/`. SHA-256 hashes pinned in `_manifest.json` and `ATTRIBUTION.md`.
  - `lang-plantuml`: hand-authored `simple/`, `medium/` and 5 `complex/` diagrams (class, sequence, component, state, C4 context). The fixtures intentionally cover diagram families the regex extractor does not yet handle, so a future extractor extension already has its regression surface ready.
  - `lang-svg`: hand-authored `simple/layout.svg` and `medium/dashboard.svg`, plus a 75-icon snapshot of `simple-icons/simple-icons` 16.22.0 (CC0).

  The fixture directories are excluded from the published npm tarballs (the `files` whitelist already covers `dist`/`grammars`/`README.md`/`LICENSE` only) and from ESLint (`tests/fixtures/complex/**` is now ignored at the workspace level so vendored sources are never autofixed).

- 75b2b38: chore(langs): npm-friendly READMEs and discovery keywords

  Reshape the four `@reponova/lang-*` README files for npm consumers:

  - Drop the `Test fixtures` / `Known limitation` / `Tree-sitter grammar` / `Class heritage extraction` sections — those are repo-internal concerns that are already covered by the source tree, the package's own tests, and the contributing guide. They have no value on the npm registry.
  - Standardise every plugin around the same five sections: `Install`, `What it extracts`, `Extensions`, `Configuration` (with a uniform property table), `Resolution semantics`, `License`.
  - Promote `lang-typescript` and `lang-python` to the same `enabled / patterns / exclude` configuration table style already used by `lang-plantuml` and `lang-svg`, so configuration documentation is homogeneous across the four published plugins.

  Add `keywords` to every plugin's `package.json` so npm search surfaces them under their language, file extension, and feature aliases (`tree-sitter`, `static-analysis`, `knowledge-graph`, `class-diagram`, `c4-diagram`, `vector-graphics`, …).

  Slim the workspace root README down to consumer / discovery content: package matrix, install snippet, architecture, link to `CONTRIBUTING.md`. Move the developer-facing material (local setup, grammar workflow, npm OIDC trust publisher, scaffold, release procedure, repository layout) to a new `CONTRIBUTING.md` so contributors still have one canonical place to look.

  No source-code or behavioural changes.

## 0.2.0

### Minor Changes

- bab08eb: Migrate to the unified `reponova-langs` monorepo.

  No behavioural changes to the extractors. Internals:

  - `peerDependencies.reponova` tightened from `^0.x` to `^0.4.0`
  - `engines.node` declared as `>=18` in every package
  - Build/test/typecheck configs now extend shared monorepo bases
  - Released from a single repository with coordinated CI on Ubuntu / Windows / macOS x Node 18 / 20 / 22
