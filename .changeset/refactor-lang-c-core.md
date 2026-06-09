---
"@reponova/lang-c": minor
---

Refactor: extract the C extraction core (`CFamilyExtractor`, `createCFamilyOutline`, `resolveCInclude`, declarator / path / doxy helpers) into a new workspace-internal package `@reponova/lang-c-core`. The package is `"private": true` and never published; `@reponova/lang-c` bundles it inline via `tsup --noExternal` so the published tarball is fully self-contained.

This change is invisible to consumers of `@reponova/lang-c`:

- the `LanguagePlugin` shape is unchanged (`id: "c"`, extensions `[".c", ".h"]`, `wasmFile: "tree-sitter-c.wasm"`),
- extraction output (`symbols`, `imports`, `references`, `exports`) is byte-for-byte identical for every existing fixture (simple greeter, medium cache, complex cJSON 1.7.18),
- `resolveImportPath` semantics are preserved (delegating to the new standalone `resolveCInclude`),
- published `dist/index.d.ts` keeps re-exporting `CFamilyExtractor` (renamed from `CExtractor`) — the alias is available alongside.

The motivation is to let the upcoming `@reponova/lang-cpp` plugin reuse the C subset of extraction (functions, structs/unions/enums, typedefs, macros, globals, the `#include` resolver, the preproc-conditional walker, declarator helpers) instead of duplicating ~970 LOC. C++ subclasses `CFamilyExtractor` and overrides `dispatchTopLevel` to add namespace / class / template / using handling on top of the C subset, chaining back via `super.dispatchTopLevel`.

The existing C fixture suite (simple, medium, complex / cJSON) and 35 extractor unit tests + 10 resolver / helpers unit tests now live in `@reponova/lang-c-core`. `@reponova/lang-c` keeps a 5-test plugin-shape smoke suite verifying the published `LanguagePlugin` contract. Coverage gate on `extractor.ts` lands at 97.33%; bundle size at 40.91 KB / 50 KB budget.
