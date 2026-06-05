# @reponova/lang-javascript

JavaScript language support for [RepoNova](https://github.com/CristianoCiuti/reponova). Parses `.js`, `.mjs`, `.cjs`, and `.jsx` files via the official [`tree-sitter-javascript`](https://github.com/tree-sitter/tree-sitter-javascript) WASM grammar (which has native JSX support inline) and produces graph-ready symbols, imports, and references.

This plugin is the JavaScript sibling of [`@reponova/lang-typescript`](https://www.npmjs.com/package/@reponova/lang-typescript) and [`@reponova/lang-tsx`](https://www.npmjs.com/package/@reponova/lang-tsx). All three share the same extractor implementation and emit identical `FileExtraction` shapes, so a graph that mixes `.js` / `.ts` / `.jsx` / `.tsx` files is fully homogeneous — every code-flow analysis written against one applies to the others without translation.

## Install

```bash
reponova lang add @reponova/lang-javascript
```

## What it extracts

- **Symbols**:
  - `function` declarations and arrow-function constants (`const App = () => …`) hoisted as functions — captures most React-style functional components
  - `class` declarations with `extends`
  - `method` definitions on classes, including `constructor`
  - Class fields (`public_field_definition` / `class_static_block`) as `variable` symbols hung under the class, preserving `static` as a decorator
  - Getters and setters as separate symbols, tagged with `getter` / `setter` decorators
  - Top-level `UPPER_SNAKE_CASE` constants
  - Any *exported* `const` / `let` / `var` binding (`export const handler = …`) as a `constant` symbol
  - CommonJS `module.exports = …` and `exports.foo = …` are recorded as exports (no separate symbol unless the assigned expression is itself a function / class declaration)
- **Modifier markers** (prepended to `decorators`): `async`, `generator`, `getter`, `setter`, plus `static` for class fields
- **Edges**:
  - `extends` from each class to its base class
  - `calls` from each function / method to every called identifier or member expression in its body. Hooks (`useState`, `useEffect`, …) and JSX component calls (`<Card />` → `Card`) both surface as `calls`.
- **Imports**: ES module `import` (default, named, namespace, side-effect, dynamic `import('…')`), and CommonJS `require('…')` — both produce identical edges.
- **Re-exports**: `export … from '…'` (flagged with `isExport: true`).
- **Docstrings**: the leading `/** … */` JSDoc block at file start (module docstring), at every top-level declaration, and at every class member.
- **Decorators**: TC39 stage-3 decorators on classes, methods, and class fields (`@Logger`, `@loggable`) where the JS dialect supports them.
- **File node kind**: `module`.

## Extensions

`.js`, `.mjs`, `.cjs`, `.jsx`

A single `tree-sitter-javascript` grammar handles all four: there is no separate `tree-sitter-jsx` grammar (unlike TS, where `.tsx` has its own grammar — handled by [`@reponova/lang-tsx`](https://www.npmjs.com/package/@reponova/lang-tsx)). Mixing JSX and non-JSX JavaScript files in the same codebase is the common case and is supported transparently by this single plugin.

## Configuration

In `reponova.yml`:

```yaml
plugins:
  javascript:
    enabled: true       # default: true
    # patterns: []      # override global patterns for JS files
    # exclude: []       # override global exclude for JS files
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable JavaScript file detection and extraction |
| `patterns` | string[] | `[]` | Glob patterns to override global file matching for this plugin |
| `exclude` | string[] | `[]` | Glob patterns to override global exclusions for this plugin |

## Resolution semantics

- Relative (`./`, `../`) and absolute (`/`) imports resolve against the file system, trying `.js`, `.mjs`, `.cjs`, `.jsx` (in that order), then `index.js` / `index.mjs` / `index.cjs` / `index.jsx` for directory imports. The order matches the Node module-resolution preference: a sibling `.js` next to a `.jsx` of the same name wins.
- Bare specifiers (`react`, `next/image`, `@org/pkg`) resolve to `[]` and are treated as external by the host. Package-manager-specific resolution (`exports` field, conditional exports) is not applied at this layer; the host RepoNova resolver is expected to handle that.
- Default exports appear in `exports` as the literal string `"default"`; if the export has a binding (`export default function App() {}`), that name is also included.
- Both ES module `import` and CommonJS `require()` produce identical `Import` edges, so a `FileExtraction` from a `.cjs` and a `.mjs` are graph-compatible.
- Call references are recorded by name only. JSX usage `<Card title="…" />` is captured as a `calls` edge from the enclosing function to `Card`. No prop-flow tracking, no generic instantiation tracking.

## License

MIT — see [LICENSE](./LICENSE).
