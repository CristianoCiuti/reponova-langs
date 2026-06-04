# @reponova/lang-typescript

TypeScript language support for RepoNova. Parses `.ts`, `.mts`, and `.cts` files via the official [tree-sitter-typescript](https://github.com/tree-sitter/tree-sitter-typescript) WASM grammar (pinned at `v0.23.2`) and produces graph-ready symbols, imports, and references.

## Install

```bash
reponova lang add @reponova/lang-typescript
```

## What it extracts

- **Symbols**:
  - `function` declarations (incl. `async`, generators)
  - `class` and `abstract class` declarations with `extends` / `implements`
  - `method` definitions on classes (including `constructor`)
  - `interface` declarations with `extends` heritage
  - `type` aliases (`type X = ...`)
  - `enum` declarations
  - `namespace` / `module` blocks
  - Top-level arrow function constants (`const handler = () => …`) classified as functions
  - Top-level `UPPER_SNAKE_CASE` constants
- **Edges**:
  - `extends` from each class / interface to each base type
  - `calls` from each function / method to every called identifier or member expression in its body
- **Imports**: default, named (`{ a, b }`), namespace (`* as ns`), side-effect (`import 'x'`), type-only (`import type { … }`), and `export … from '…'` re-exports (flagged with `isExport: true`).
- **JSDoc docstrings**: the leading `/** … */` block immediately above the file (module docstring), each top-level declaration, and each class member.
- **Decorators**: TC39 / experimental decorators on classes and methods (`@Logger`, `@loggable`).
- **File node kind**: `module`.

## Configuration in `reponova.yml`

```yaml
plugins:
  typescript:
    enabled: true
```

## Test fixtures

The package ships three tiers of test fixtures, in line with section 8.7 of the workspace integration plan:

- **`tests/fixtures/simple/`** — focused single-file scenarios (e.g. a structured logger). Used to lock down the basic extraction shape.
- **`tests/fixtures/medium/`** — a multi-feature file exercising decorators, generics, re-exports, and class hierarchies.
- **`tests/fixtures/complex/zod-v3.24.1/`** — a 13-file, ~6.6 k LOC verbatim snapshot of the [`colinhacks/zod`](https://github.com/colinhacks/zod) `src/` tree (excluding tests and benchmarks), pinned at `v3.24.1`, MIT-licensed. Provenance and per-file SHA-256 hashes are recorded in [`ATTRIBUTION.md`](./tests/fixtures/complex/zod-v3.24.1/ATTRIBUTION.md). The complex tier guards against regressions on real-world TypeScript with heavy generics, conditional types, and class hierarchies.

## Limitations

- **`.tsx` will land as a separate `@reponova/lang-tsx` package.** TypeScript with JSX needs a separate grammar (`tree-sitter-tsx.wasm`); rather than extending the core `LanguagePlugin` contract to accept multiple grammars per plugin, we plan to ship `.tsx` as a sibling plugin that re-uses `TypescriptExtractor` from this package. Tracked for the next Wave-1 PR.
- **`tsconfig.json` `paths`** are not resolved. Bare specifiers (`@app/*`) resolve to `[]` (treated as external). Resolution still works for relative (`./`, `../`) and absolute paths.
- **Default exports** appear in `exports` as the literal string `"default"`. The original symbol name (if any) is also included.
- **Call references** are recorded by name only (`foo`, `obj.method`); we do not attempt to resolve overloads or generic instantiation.

## Tree-sitter grammar

This package depends on `tree-sitter-typescript.wasm` v0.23.2. The file is **not** committed to git; it is downloaded by `tools/grammar-fetcher` (verified via SHA-256) before each `pnpm build` / `pnpm test` and bundled into the published npm tarball. See [the workspace README](../../README.md#grammars) for details.
