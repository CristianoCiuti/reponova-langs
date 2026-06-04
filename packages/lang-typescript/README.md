# @reponova/lang-typescript

TypeScript language support for [RepoNova](https://github.com/CristianoCiuti/reponova). Parses `.ts`, `.mts`, and `.cts` files via the official [`tree-sitter-typescript`](https://github.com/tree-sitter/tree-sitter-typescript) WASM grammar.

JSX-heavy `.tsx` files are handled by the sibling [`@reponova/lang-tsx`](../lang-tsx) plugin, which re-uses the extractor in this package against the dedicated `.tsx` grammar.

## Install

```bash
reponova lang add @reponova/lang-typescript
```

## What it extracts

- **Symbols**:
  - `function` declarations and `function_signature` (`.d.ts` ambient declarations + overload signatures, deduplicated by name)
  - `class` and `abstract class` declarations with `extends` / `implements`
  - `method` definitions and `method_signature` on classes, including `constructor`. Overload signatures are deduplicated.
  - `interface` declarations with `extends` heritage
  - `type` aliases (`type X = …`)
  - `enum` declarations
  - `namespace` / `module` blocks
  - Class fields (`public_field_definition`) as `variable` symbols hung under the class, preserving `public` / `private` / `protected` / `readonly` / `static` modifiers as decorators
  - Getters and setters as separate symbols, tagged with `getter` / `setter` decorators
  - Top-level arrow-function constants (`const handler = () => …`) classified as functions
  - Top-level `UPPER_SNAKE_CASE` constants
  - Any *exported* `const` / `let` / `var` binding (`export const userService = …`) as a `constant` symbol
- **Modifier markers** (prepended to `decorators`):
  - `async` on async functions, async arrow functions, and async methods
  - `generator` on `function*` and `async function*` declarations
  - `getter` / `setter` on class accessors
  - `abstract` on abstract method signatures
- **Edges**:
  - `extends` from each class / interface to each base type (generics collapse to the bare name)
  - `calls` from each function / method to every called identifier or member expression in its body
- **Imports**: default, named (`{ a, b }`), namespace (`* as ns`), side-effect (`import 'x'`), type-only (`import type { … }`), and `export … from '…'` re-exports (flagged with `isExport: true`).
- **Docstrings**: the leading `/** … */` JSDoc block at file start (module docstring), at every top-level declaration, and at every class member.
- **Decorators**: TC39 / experimental decorators on classes, methods, and class fields (`@Logger`, `@loggable`).
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
- Function and method overloads are collapsed: a sequence of signatures followed by an implementation produces exactly one symbol per name (the implementation, or the only signature in `.d.ts` files). Getters and setters with the same name keep their own symbols.
- Call references are recorded by name only (`foo`, `obj.method`) — no overload resolution, no generic instantiation tracking.

## License

MIT — see [LICENSE](./LICENSE).
