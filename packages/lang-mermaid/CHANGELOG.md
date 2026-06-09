# @reponova/lang-mermaid

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
