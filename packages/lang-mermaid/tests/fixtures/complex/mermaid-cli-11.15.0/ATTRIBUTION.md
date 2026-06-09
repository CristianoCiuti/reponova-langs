# Complex fixture: mermaid-js/mermaid-cli `test-positive/` snapshot

This directory contains a verbatim snapshot of the `.mmd` files from the
`test-positive/` folder of [`mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli),
used as the `complex/` tier of the `@reponova/lang-mermaid` extractor test
bench (see [§5.4 of the language plugin roadmap](../../../../../../ROADMAP.md#54-test-bench)).

## Provenance

| Field | Value |
|---|---|
| Upstream repository | https://github.com/mermaid-js/mermaid-cli |
| Tag | `11.15.0` |
| Commit SHA | `ed67a4309745a3e6785f61ec4ca142d360d85f2f` |
| Source path | `test-positive/*.mmd` |
| Files included | 25 `.mmd` files (no `.md`, `.markdown`, `.json`, `.css`, `.markdown`) |
| Released | 2026-05-13 |
| Upstream license | MIT (see [LICENSE](./LICENSE)) |

## What was copied

All `.mmd` files from `test-positive/` at tag `11.15.0`. Non-`.mmd` assets
(`.md`, `.markdown`, `.json`, `.css`) were intentionally **excluded** because
they exercise the mermaid-cli's own Markdown-extraction path rather than the
pure Mermaid grammar that the extractor targets.

## How it is used

`fixtures.test.ts` walks every `.mmd` file in this directory and asserts that
the extractor:

1. Parses without throwing.
2. Emits a `fileNode` of kind `"diagram"` tagged with `["mermaid", "<family>"]`.
3. Detects the correct diagram family from the header line.

Diagram-family-specific landmarks (e.g. landmark class names in
`classDiagram-v2.mmd`, landmark commit IDs in `git-graph.mmd`) are pinned via
invariant-based assertions per §5.4 of the roadmap — not exact-graph
snapshots, so upstream additions / formatting nits do not break the gate.

## Why mermaid-cli?

The official Mermaid project (`mermaid-js/mermaid`) hosts its showcase
examples inside Markdown documentation rather than as standalone `.mmd`
files. `mermaid-cli`'s `test-positive/` is the largest curated bundle of
pure `.mmd` files in the Mermaid ecosystem under a permissive licence, and
it spans 13+ diagram families (flowchart, sequence, class, state, gitGraph,
mindmap, timeline, architecture, radar, treemap, venn, zenuml, …) — exactly
the breadth needed for an invariant-based complex-tier smoke test.

## License

Mermaid CLI is licensed under the [MIT License](./LICENSE). The snapshot is
preserved unmodified; any analysis or assertions about it live in this
package's `tests/` folder, not in the fixture itself.
