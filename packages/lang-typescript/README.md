# @reponova/lang-typescript

TypeScript language support for [RepoNova](https://github.com/CristianoCiuti/reponova). Parses `.ts`, `.mts`, and `.cts` files via the official [`tree-sitter-typescript`](https://github.com/tree-sitter/tree-sitter-typescript) WASM grammar.

JSX-heavy `.tsx` files are handled by the sibling [`@reponova/lang-tsx`](../lang-tsx) plugin, which re-uses the extractor in this package against the dedicated `.tsx` grammar.

## Install

```bash
reponova lang add @reponova/lang-typescript
```

## What it extracts

- **Symbols**:
  - `function` declarations (including `async` and generators)
  - `class` and `abstract class` declarations with `extends` / `implements`
  - `method` definitions on classes (including `constructor`)
  - `interface` declarations with `extends` heritage
  - `type` aliases (`type X = …`)
  - `enum` declarations
  - `namespace` / `module` blocks
  - Top-level arrow-function constants (`const handler = () => …`) classified as functions
  - Top-level `UPPER_SNAKE_CASE` constants
- **Edges**:
  - `extends` from each class / interface to each base type (generics collapse to the bare name)
  - `calls` from each function / method to every called identifier or member expression in its body
- **Imports**: default, named (`{ a, b }`), namespace (`* as ns`), side-effect (`import 'x'`), type-only (`import type { … }`), and `export … from '…'` re-exports (flagged with `isExport: true`).
- **Docstrings**: the leading `/** … */` JSDoc block at file start (module docstring), at every top-level declaration, and at every class member.
- **Decorators**: TC39 / experimental decorators on classes and methods (`@Logger`, `@loggable`).
- **File node kind**: `module`.

## Extensions

`.ts`, `.mts`, `.cts`

## Configuration

In `reponova.yml`:

```yaml
plugins:
  typescript:
    enabled: true       # default: true
    # patterns: []      # override global patterns for TypeScript files
    # exclude: []       # override global exclude for TypeScript files
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable TypeScript file detection and extraction |
| `patterns` | string[] | `[]` | Glob patterns to override global file matching for this plugin |
| `exclude` | string[] | `[]` | Glob patterns to override global exclusions for this plugin |

## Resolution semantics

- Relative (`./`, `../`) and absolute (`/`) imports resolve against the file system, trying `.ts`, `.mts`, `.cts`, `.d.ts`, then `index.ts` / `index.mts` / `index.cts` / `index.d.ts` for directory imports.
- Bare specifiers (`react`, `@org/pkg`) resolve to `[]` and are treated as external by the host. `tsconfig.json` `paths` rewriting is not applied at this layer; the host RepoNova resolver is expected to apply project-level rewrites if needed.
- Default exports appear in `exports` as the literal string `"default"`; if the export has a binding, that name is also included.
- Call references are recorded by name only (`foo`, `obj.method`) — no overload resolution, no generic instantiation tracking.

## License

MIT — see [LICENSE](./LICENSE).
