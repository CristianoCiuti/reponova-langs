# @reponova/lang-tsx

TSX (TypeScript + JSX) language support for [RepoNova](https://github.com/CristianoCiuti/reponova). Parses `.tsx` files via the official [`tree-sitter-typescript`](https://github.com/tree-sitter/tree-sitter-typescript) WASM grammar — specifically the dedicated `tree-sitter-tsx.wasm` build that handles JSX syntax — and produces graph-ready symbols, imports, and references.

This plugin is the JSX-aware sibling of [`@reponova/lang-typescript`](https://www.npmjs.com/package/@reponova/lang-typescript): both share the same extractor implementation and emit identical `FileExtraction` shapes, so a graph that mixes `.ts` and `.tsx` files is fully homogeneous.

## Install

```bash
reponova lang add @reponova/lang-tsx
```

## What it extracts

- **Symbols**:
  - `function` declarations and `function_signature` (overload signatures, deduplicated by name)
  - `class` and `abstract class` declarations with `extends` / `implements`
  - `method` definitions and `method_signature` on classes, including `constructor` (overload-deduplicated)
  - `interface` declarations with `extends` heritage
  - `type` aliases (`type X = …`)
  - `enum` declarations
  - `namespace` / `module` blocks
  - Class fields (`public_field_definition`) as `variable` symbols hung under the class, preserving `public` / `private` / `protected` / `readonly` / `static` modifiers as decorators
  - Getters and setters as separate symbols, tagged with `getter` / `setter` decorators
  - Top-level arrow-function constants (`const Card = (props) => <div>…</div>`) classified as functions — captures most React-style functional components
  - Top-level `UPPER_SNAKE_CASE` constants
  - Any *exported* `const` / `let` / `var` binding (`export const handler = …`) as a `constant` symbol
- **Modifier markers** (prepended to `decorators`): `async`, `generator`, `getter`, `setter`, `abstract`, plus accessibility / `readonly` / `static` for class fields
- **Edges**:
  - `extends` from each class / interface to each base type (generics collapse to the bare name)
  - `calls` from each function / method to every called identifier or member expression in its body. Hooks (`useState`, `useEffect`, …) and JSX component calls (`<Card />` → `Card`) both surface as `calls`.
- **Imports**: default, named (`{ a, b }`), namespace (`* as ns`), side-effect (`import 'x'`), type-only (`import type { … }`), and `export … from '…'` re-exports (flagged with `isExport: true`).
- **Docstrings**: the leading `/** … */` JSDoc block at file start (module docstring), at every top-level declaration, and at every class member.
- **Decorators**: TC39 / experimental decorators on classes, methods, and class fields (`@Logger`, `@loggable`).
- **File node kind**: `module`.

## Extensions

`.tsx`

Pure `.ts` / `.mts` / `.cts` files are handled by the sibling [`@reponova/lang-typescript`](https://www.npmjs.com/package/@reponova/lang-typescript) plugin. Install both if your codebase mixes JSX and non-JSX TypeScript.

## Configuration

In `reponova.yml`:

```yaml
plugins:
  tsx:
    enabled: true       # default: true
    # patterns: []      # override global patterns for TSX files
    # exclude: []       # override global exclude for TSX files
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable TSX file detection and extraction |
| `patterns` | string[] | `[]` | Glob patterns to override global file matching for this plugin |
| `exclude` | string[] | `[]` | Glob patterns to override global exclusions for this plugin |

## Resolution semantics

- Relative (`./`, `../`) and absolute (`/`) imports resolve against the file system, trying `.tsx`, `.ts`, `.mts`, `.cts`, `.d.ts` (in that order), then `index.tsx` / `index.ts` / `index.mts` / `index.cts` / `index.d.ts` for directory imports. The order matches the typical TSX-project preference: a sibling `.tsx` next to a `.ts` of the same name is intentional and the `.tsx` wins.
- Bare specifiers (`react`, `next/image`, `@org/pkg`) resolve to `[]` and are treated as external by the host. `tsconfig.json` `paths` rewriting is not applied at this layer; the host RepoNova resolver is expected to apply project-level rewrites if needed.
- Default exports appear in `exports` as the literal string `"default"`; if the export has a binding (`export default function App() {}`), that name is also included.
- Function and method overloads collapse to a single symbol per name (the implementation, or the lone signature in `.d.ts`). Getters and setters with the same name keep their own symbols.
- Call references are recorded by name only — JSX usage like `<Card title="…" />` is captured as a `calls` edge from the enclosing function to `Card`. No prop-flow tracking, no generic instantiation tracking.

## License

MIT — see [LICENSE](./LICENSE).
