# @reponova/lang-mermaid

## 0.1.1

### Patch Changes

- 5a0674d: Drop the dead `configDefaults: { parse: true }` knob from `lang-plantuml`, `lang-svg`, `lang-mermaid`, and `lang-sql`.

  The `parse` flag has never been wired into either of RepoNova's plugin entry-points (`LanguageExtractor.extract()` / `LanguageSupport.treeSitterExtract()` / `LanguageSupport.regexExtract()`) — all three signatures receive `(file, source, …)` only, and the pipeline phases (`graph`, `outlines`) read `enabled` / `patterns` / `exclude` from `config.plugins[id]` but discard everything else. Declaring the default therefore (a) wrote a `parse: true` row into `reponova.yml` on `reponova lang add` that did nothing and (b) misled users in the per-plugin Configuration tables.

  This release removes the field from each plugin's entry, drops the `parse` row from each README's Configuration section, and updates the smoke-test assertions accordingly. No runtime behaviour changes — the flag was already a no-op.

  A future RepoNova release will introduce explicit per-plugin config threading (see the `reponova` core change set). Once that lands, plugins will be free to declare meaningful `configDefaults` entries and read them back inside `extract` / `treeSitterExtract` / `regexExtract`. The current `lang-json` `configDefaults: { maxGenericKeys: 200 }` is left in place because it already represents a meaningful, plugin-internal knob (consumed today via the `JsonExtractor` constructor).

## 0.1.0

### Minor Changes

- 625871e: Add Mermaid diagram support (`.mmd` / `.mermaid`) covering 13+ diagram families:
  flowchart, sequence, class (incl. v2), state (incl. v2), ER, gantt, journey,
  gitGraph, pie, mindmap, timeline, C4 (Context / Container / Component /
  Deployment / Dynamic), requirement, and zenuml. Unknown / niche diagram types
  (architecture-beta, block-beta, xychart-beta, quadrantChart, radar-beta,
  sankey-beta, packet-beta, kanban, treemap, venn-beta, ishikawa, …) still
  produce a valid `fileNode` tagged `["mermaid", "unknown"]` so the file
  participates in downstream phases (search, embeddings) without breaking the
  pipeline.

  The extractor is regex-based, ships no tree-sitter grammar, and stays well
  under the 50 KB size budget. Resolution semantics: Mermaid files do not
  reference each other, so `resolveImportPath` is a hard no-op. The complex
  test tier is a SHA-pinned snapshot of `mermaid-js/mermaid-cli@11.15.0`
  `test-positive/*.mmd` (MIT).
