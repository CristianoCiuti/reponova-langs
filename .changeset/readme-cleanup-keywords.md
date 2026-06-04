---
"@reponova/lang-typescript": patch
"@reponova/lang-python": patch
"@reponova/lang-plantuml": patch
"@reponova/lang-svg": patch
---

chore(langs): npm-friendly READMEs and discovery keywords

Reshape the four `@reponova/lang-*` README files for npm consumers:

- Drop the `Test fixtures` / `Known limitation` / `Tree-sitter grammar` / `Class heritage extraction` sections — those are repo-internal concerns that are already covered by the source tree, the package's own tests, and the contributing guide. They have no value on the npm registry.
- Standardise every plugin around the same five sections: `Install`, `What it extracts`, `Extensions`, `Configuration` (with a uniform property table), `Resolution semantics`, `License`.
- Promote `lang-typescript` and `lang-python` to the same `enabled / patterns / exclude` configuration table style already used by `lang-plantuml` and `lang-svg`, so configuration documentation is homogeneous across the four published plugins.

Add `keywords` to every plugin's `package.json` so npm search surfaces them under their language, file extension, and feature aliases (`tree-sitter`, `static-analysis`, `knowledge-graph`, `class-diagram`, `c4-diagram`, `vector-graphics`, …).

Slim the workspace root README down to consumer / discovery content: package matrix, install snippet, architecture, link to `CONTRIBUTING.md`. Move the developer-facing material (local setup, grammar workflow, npm OIDC trust publisher, scaffold, release procedure, repository layout) to a new `CONTRIBUTING.md` so contributors still have one canonical place to look.

No source-code or behavioural changes.
