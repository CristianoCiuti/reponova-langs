# @reponova/lang-typescript

## 0.2.0

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

## 0.1.3

### Patch Changes

- ebf8067: Add `@reponova/lang-javascript`, the JavaScript language plugin (handles `.js`, `.mjs`, `.cjs`, and `.jsx` via the `tree-sitter-javascript` WASM grammar v0.25.0). Symbol-extraction and outline logic are shared with `@reponova/lang-typescript` and `@reponova/lang-tsx` through the workspace-internal `@reponova/lang-typescript-core` package, so a graph that mixes JS / TS / JSX / TSX files emits a homogeneous `FileExtraction` shape.

  Five extractor improvements landed in `lang-typescript-core` to make a single core handle the JS grammar in addition to the TS grammar; both `lang-typescript` and `lang-tsx` benefit transparently:

  - **CommonJS `require()` imports**: `var x = require('mod')`, `const { y } = require('mod')`, `const path = require('node:path')` are now recognised as `Import` entries (treated as a default import for the binding-name form, named imports for object-pattern destructuring), so a CJS-only module like Express's `lib/` produces an `imports` list indistinguishable from an ESM equivalent.
  - **JS-grammar `class_heritage`**: tree-sitter-javascript exposes the heritage expression directly as a child of `class_heritage` (no `extends_clause` wrapper, unlike tree-sitter-typescript). The shared extractor now accepts both shapes, so `class Modal extends Component { … }` populates `bases` correctly in both grammars.
  - **`generator_function_declaration`**: tree-sitter-javascript emits a distinct node kind for `function* gen()` (vs tree-sitter-typescript which folds it into `function_declaration` + `*` token). The shared extractor now matches both and surfaces the `generator` modifier from the node type itself.
  - **JS-grammar `field_definition`**: tree-sitter-javascript exposes class fields as `field_definition` (vs tree-sitter-typescript's `public_field_definition`) with the field name under the `property` field rather than `name`. The shared `extractClassField` accepts both shapes plus a property-identifier fallback.
  - **`new X()` as a call edge**: `new EventEmitter()`, `new HttpError(404)`, … are now recorded as calls to the constructor name, mirroring how `call_expression` to a factory function would surface. Applies uniformly to both grammars.

## 0.1.2

### Patch Changes

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

## 0.1.1

### Patch Changes

- 99669f9: Internal refactor: the `TypescriptExtractor` and outline implementation move to the workspace-internal `@reponova/lang-typescript-core` package and are now bundled inline at publish time. Public API and on-the-wire tarball contents are unchanged for consumers; the extractor is now parameterizable so it can be reused as-is by the upcoming `@reponova/lang-tsx` sibling plugin.

## 0.1.0

### Minor Changes

- 55f83b2: Initial release of `@reponova/lang-typescript` (Wave 1, plugin 1/3 of the Web stack).

  Parses `.ts`, `.mts`, `.cts` source files via `tree-sitter-typescript@v0.23.2` and produces:

  - Symbols: functions, methods, classes (incl. `abstract`, `extends`, `implements`), interfaces, type aliases, enums, namespaces, top-level arrow-function constants, and `UPPER_SNAKE_CASE` module constants.
  - References: `extends` (classes / interfaces), `calls` inside function and method bodies.
  - Imports: default, named, namespace (`* as ns`), side-effect, type-only, and `export … from '…'` re-exports.
  - JSDoc: module docstring, leading `/** */` blocks on declarations and methods.
  - Decorators: TC39 / experimental decorators on classes and methods.
  - Outline: tree-sitter primary + regex fallback (mirrors the lang-python plugin shape).

  Currently scoped to non-JSX TypeScript only; `.tsx` requires a second grammar and a small contract extension in the `reponova` core (planned for v0.2.0). The grammar `.wasm` is fetched at build/test time by `@reponova/grammar-fetcher` and shipped in the published tarball — see the workspace README for details.

- adecf16: feat(lang-typescript): class fields, accessors, async / generator markers, exported const, overload dedup, .d.ts ambient declarations

  Closes the documented coverage gaps in the TypeScript extractor:

  - **Class fields** (`public_field_definition`): `class HttpClient { private readonly baseUrl: string; static defaultTimeoutMs = 30_000; }` now surfaces `baseUrl` and `defaultTimeoutMs` as `variable` symbols hung under their class. Accessibility (`public` / `private` / `protected`), `readonly`, and `static` are preserved in `decorators`. Previously fields were silently dropped — only methods were captured.
  - **Getters and setters**: `class Counter { get value() {…}; set value(v) {…} }` now produces two separate symbols, both with the clean `qualifiedName` `mod.Counter.value` and tagged `decorators: ["getter"]` / `["setter"]` respectively.
  - **Async / generator markers**: `async function`, `async () => …`, `async method()`, and `function* gen()` carry `"async"` and/or `"generator"` as the first entries of their `decorators` array.
  - **Abstract methods**: `abstract bar(): void` now produces a method symbol decorated with `"abstract"`.
  - **Exported `const` of any case**: `export const userService = createUserService()` now produces a `constant` symbol. The previous release only kept `UPPER_SNAKE_CASE` bindings, silently dropping the canonical TypeScript DI / module-singleton pattern. Internal lowercase non-arrow `const` bindings remain hidden.
  - **`function_signature` / `method_signature` / `abstract_method_signature`**: tree-sitter-typescript represents `.d.ts` ambient declarations and overload signatures with these node types. They are now extracted, so `.d.ts` files produce graph symbols for the first time.
  - **Overload dedup**: a sequence of `function format(x: number): string;` / `function format(x: string): string;` / `function format(x: number | string): string { … }` collapses to exactly one symbol per name (the implementation). Same logic applies to method overloads inside classes. Getters and setters with the same name are NOT deduped against each other.

  Five new unit tests pin: class fields with modifiers, getter/setter pairs, async / generator markers, exported const promotion, overload dedup. The 22 existing unit tests, the 5 zod v3.24.1 complex-fixture tests, and the resolve-imports tests all continue to pass unchanged.

### Patch Changes

- 57ee727: Add complex/ test tier: a 13-file, ~6.6 k LOC verbatim snapshot of `colinhacks/zod` v3.24.1 `src/`. The snapshot exercises real-world TypeScript with heavy generics, conditional types, class hierarchies, and barrel re-exports, and is wired into Vitest as `tests/complex.test.ts`. Provenance and per-file SHA-256 hashes are recorded in `tests/fixtures/complex/zod-v3.24.1/ATTRIBUTION.md`. No runtime behaviour change; this is a test-coverage uplift only.
- 75b2b38: chore(langs): npm-friendly READMEs and discovery keywords

  Reshape the four `@reponova/lang-*` README files for npm consumers:

  - Drop the `Test fixtures` / `Known limitation` / `Tree-sitter grammar` / `Class heritage extraction` sections — those are repo-internal concerns that are already covered by the source tree, the package's own tests, and the contributing guide. They have no value on the npm registry.
  - Standardise every plugin around the same five sections: `Install`, `What it extracts`, `Extensions`, `Configuration` (with a uniform property table), `Resolution semantics`, `License`.
  - Promote `lang-typescript` and `lang-python` to the same `enabled / patterns / exclude` configuration table style already used by `lang-plantuml` and `lang-svg`, so configuration documentation is homogeneous across the four published plugins.

  Add `keywords` to every plugin's `package.json` so npm search surfaces them under their language, file extension, and feature aliases (`tree-sitter`, `static-analysis`, `knowledge-graph`, `class-diagram`, `c4-diagram`, `vector-graphics`, …).

  Slim the workspace root README down to consumer / discovery content: package matrix, install snippet, architecture, link to `CONTRIBUTING.md`. Move the developer-facing material (local setup, grammar workflow, npm OIDC trust publisher, scaffold, release procedure, repository layout) to a new `CONTRIBUTING.md` so contributors still have one canonical place to look.

  No source-code or behavioural changes.
