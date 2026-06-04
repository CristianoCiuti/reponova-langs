---
"@reponova/lang-typescript": minor
---

Initial release of `@reponova/lang-typescript` (Wave 1, plugin 1/3 of the Web stack).

Parses `.ts`, `.mts`, `.cts` source files via `tree-sitter-typescript@v0.23.2` and produces:

- Symbols: functions, methods, classes (incl. `abstract`, `extends`, `implements`), interfaces, type aliases, enums, namespaces, top-level arrow-function constants, and `UPPER_SNAKE_CASE` module constants.
- References: `extends` (classes / interfaces), `calls` inside function and method bodies.
- Imports: default, named, namespace (`* as ns`), side-effect, type-only, and `export … from '…'` re-exports.
- JSDoc: module docstring, leading `/** */` blocks on declarations and methods.
- Decorators: TC39 / experimental decorators on classes and methods.
- Outline: tree-sitter primary + regex fallback (mirrors the lang-python plugin shape).

Currently scoped to non-JSX TypeScript only; `.tsx` requires a second grammar and a small contract extension in the `reponova` core (planned for v0.2.0). The grammar `.wasm` is fetched at build/test time by `@reponova/grammar-fetcher` and shipped in the published tarball — see the workspace README for details.
