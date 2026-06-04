---
"@reponova/lang-python": patch
"@reponova/lang-plantuml": patch
"@reponova/lang-svg": patch
---

Add `simple/` + `medium/` + `complex/` test fixture tiers, in line with section 8.7 of the integration plan, bringing the three Wave-0 plugins to the same coverage shape as `@reponova/lang-typescript`. No runtime behaviour change.

- `lang-python`: hand-authored `simple/cli.py` and `medium/cache.py`, plus a 17-file verbatim snapshot of `pallets/click` 8.4.1 (BSD-3-Clause) under `complex/click-8.4.1/`. SHA-256 hashes pinned in `_manifest.json` and `ATTRIBUTION.md`.
- `lang-plantuml`: hand-authored `simple/`, `medium/` and 5 `complex/` diagrams (class, sequence, component, state, C4 context). The fixtures intentionally cover diagram families the regex extractor does not yet handle, so a future extractor extension already has its regression surface ready.
- `lang-svg`: hand-authored `simple/layout.svg` and `medium/dashboard.svg`, plus a 75-icon snapshot of `simple-icons/simple-icons` 16.22.0 (CC0).

The fixture directories are excluded from the published npm tarballs (the `files` whitelist already covers `dist`/`grammars`/`README.md`/`LICENSE` only) and from ESLint (`tests/fixtures/complex/**` is now ignored at the workspace level so vendored sources are never autofixed).
