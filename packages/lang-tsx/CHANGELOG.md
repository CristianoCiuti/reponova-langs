# @reponova/lang-tsx

## 0.3.0

### Minor Changes

- e6c20e7: Align official plugins with reponova v0.6 manifest spec.

  - `package.json.keywords` switches to the single canonical token
    `reponova-language` (the legacy `reponova-plugin` / `language-plugin`
    keywords are removed). This is the only keyword now consulted by
    `reponova lang suggest` on the npm registry.
  - `package.json.reponova.extensions[]` is now the single source of truth
    for file extensions. The previously-duplicated `extensions` field on the
    exported `LanguagePlugin` object has been removed — the loader reads
    extensions from the manifest exclusively.
  - `peerDependencies.reponova` bumped to `^0.6.0` (the host release that
    introduced the new manifest validation).

## 0.2.1

### Patch Changes

- ebf8067: Add `@reponova/lang-javascript`, the JavaScript language plugin (handles `.js`, `.mjs`, `.cjs`, and `.jsx` via the `tree-sitter-javascript` WASM grammar v0.25.0). Symbol-extraction and outline logic are shared with `@reponova/lang-typescript` and `@reponova/lang-tsx` through the workspace-internal `@reponova/lang-typescript-core` package, so a graph that mixes JS / TS / JSX / TSX files emits a homogeneous `FileExtraction` shape.

  Five extractor improvements landed in `lang-typescript-core` to make a single core handle the JS grammar in addition to the TS grammar; both `lang-typescript` and `lang-tsx` benefit transparently:

  - **CommonJS `require()` imports**: `var x = require('mod')`, `const { y } = require('mod')`, `const path = require('node:path')` are now recognised as `Import` entries (treated as a default import for the binding-name form, named imports for object-pattern destructuring), so a CJS-only module like Express's `lib/` produces an `imports` list indistinguishable from an ESM equivalent.
  - **JS-grammar `class_heritage`**: tree-sitter-javascript exposes the heritage expression directly as a child of `class_heritage` (no `extends_clause` wrapper, unlike tree-sitter-typescript). The shared extractor now accepts both shapes, so `class Modal extends Component { … }` populates `bases` correctly in both grammars.
  - **`generator_function_declaration`**: tree-sitter-javascript emits a distinct node kind for `function* gen()` (vs tree-sitter-typescript which folds it into `function_declaration` + `*` token). The shared extractor now matches both and surfaces the `generator` modifier from the node type itself.
  - **JS-grammar `field_definition`**: tree-sitter-javascript exposes class fields as `field_definition` (vs tree-sitter-typescript's `public_field_definition`) with the field name under the `property` field rather than `name`. The shared `extractClassField` accepts both shapes plus a property-identifier fallback.
  - **`new X()` as a call edge**: `new EventEmitter()`, `new HttpError(404)`, … are now recorded as calls to the constructor name, mirroring how `call_expression` to a factory function would surface. Applies uniformly to both grammars.

## 0.2.0

### Minor Changes

- 2fcc276: Add `@reponova/lang-tsx` plugin for TSX (TypeScript + JSX) source files.

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

  Quality gates:

  - 34 tests across 6 suites: plugin shape, resolveImportPath, extractor on
    inline TSX scenarios, outline (tree-sitter + regex fallback),
    hand-written `simple/` (~50 LOC) and `medium/` (~250 LOC, mix of
    functional + class component) fixtures, plus a verbatim snapshot of
    `vercel/next.js/examples/with-typescript` (commit
    `84f9247617f91917bfeecd9c6d95b1dedef4a411`, MIT, SHA-256-pinned in
    `_manifest.json` and integrity-checked at every test run).
  - Build inlines `@reponova/lang-typescript-core` via `tsup --noExternal`
    - `dts: { resolve: true }`; published tarball is fully self-contained.
  - TSX wasm grammar (`tree-sitter-tsx@v0.23.2`,
    sha256 `79e5da75…30f8`) registered in
    `tools/grammar-fetcher/grammars.json` and verified on every pre-test /
    pre-build run.
