---
"@reponova/lang-plantuml": patch
"@reponova/lang-svg": patch
"@reponova/lang-mermaid": patch
"@reponova/lang-sql": patch
---

Drop the dead `configDefaults: { parse: true }` knob from `lang-plantuml`, `lang-svg`, `lang-mermaid`, and `lang-sql`.

The `parse` flag has never been wired into either of RepoNova's plugin entry-points (`LanguageExtractor.extract()` / `LanguageSupport.treeSitterExtract()` / `LanguageSupport.regexExtract()`) — all three signatures receive `(file, source, …)` only, and the pipeline phases (`graph`, `outlines`) read `enabled` / `patterns` / `exclude` from `config.plugins[id]` but discard everything else. Declaring the default therefore (a) wrote a `parse: true` row into `reponova.yml` on `reponova lang add` that did nothing and (b) misled users in the per-plugin Configuration tables.

This release removes the field from each plugin's entry, drops the `parse` row from each README's Configuration section, and updates the smoke-test assertions accordingly. No runtime behaviour changes — the flag was already a no-op.

A future RepoNova release will introduce explicit per-plugin config threading (see the `reponova` core change set). Once that lands, plugins will be free to declare meaningful `configDefaults` entries and read them back inside `extract` / `treeSitterExtract` / `regexExtract`. The current `lang-json` `configDefaults: { maxGenericKeys: 200 }` is left in place because it already represents a meaningful, plugin-internal knob (consumed today via the `JsonExtractor` constructor).
