---
"@reponova/lang-tsx": minor
"@reponova/lang-typescript": patch
---

Add `@reponova/lang-tsx` plugin for TSX (TypeScript + JSX) source files.

The new plugin reuses the shared extractor from
`@reponova/lang-typescript-core` against the dedicated `tree-sitter-tsx.wasm`
grammar, so feature parity with `@reponova/lang-typescript` is automatic and
bug fixes propagate to both. Resolution candidates are widened to try `.tsx`
first, then `.ts`/`.mts`/`.cts`/`.d.ts`, mirroring the typical TSX-project
preference where a `Foo.tsx` next to a `Foo.ts` is intentional.

A side-effect of this work also benefits `@reponova/lang-typescript`: the
shared `extractCalls` now records JSX component usages (`<Card />`,
`<Foo.Bar />`) as `calls` edges, filtering out lower-case native HTML / SVG
tags. For pure-TypeScript files this is a no-op (the grammar emits no JSX
nodes); for TSX it makes the call graph dense and useful.

Quality gates per `INTEGRATION-PLAN.md` §8.10:

- 34 tests across 6 suites: plugin shape, resolveImportPath, extractor on
  inline TSX scenarios, outline (tree-sitter + regex fallback),
  hand-written `simple/` (~50 LOC) and `medium/` (~250 LOC, mix of
  functional + class component) fixtures, plus a verbatim snapshot of
  `vercel/next.js/examples/with-typescript` (commit
  `84f9247617f91917bfeecd9c6d95b1dedef4a411`, MIT, SHA-256-pinned in
  `_manifest.json` and integrity-checked at every test run).
- Build inlines `@reponova/lang-typescript-core` via `tsup --noExternal`
  + `dts: { resolve: true }`; published tarball is fully self-contained.
- TSX wasm grammar (`tree-sitter-tsx@v0.23.2`,
  sha256 `79e5da75…30f8`) registered in
  `tools/grammar-fetcher/grammars.json` and verified on every pre-test /
  pre-build run.
