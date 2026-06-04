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

## Limitations

- **`.tsx` is not supported in v0.1.0.** TypeScript with JSX needs a separate grammar (`tree-sitter-tsx.wasm`), and the current `LanguagePlugin` contract supports only one grammar per plugin. Adding `.tsx` requires extending the contract in the `reponova` core. Tracked for v0.2.0.
- **`tsconfig.json` `paths`** are not resolved. Bare specifiers (`@app/*`) resolve to `[]` (treated as external). Resolution still works for relative (`./`, `../`) and absolute paths.
- **Default exports** appear in `exports` as the literal string `"default"`. The original symbol name (if any) is also included.
- **Call references** are recorded by name only (`foo`, `obj.method`); we do not attempt to resolve overloads or generic instantiation.

## Tree-sitter grammar

This package depends on `tree-sitter-typescript.wasm` v0.23.2. The file is **not** committed to git; it is downloaded by `tools/grammar-fetcher` (verified via SHA-256) before each `pnpm build` / `pnpm test` and bundled into the published npm tarball. See [the workspace README](../../README.md#grammars) for details.
