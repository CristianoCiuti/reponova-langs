# @reponova/lang-c

## 0.1.0

### Minor Changes

- 718ffce: Add C language support (`.c`, `.h`) backed by the official
  `tree-sitter-c` v0.24.2 WASM grammar. Fourth package in the Priority
  pack (ROADMAP §6.1), second Archetype-A entry after Mermaid (B),
  SQL (B), and Java (A). The extractor handles C99 / C11 / C17 features:

  - **Symbols**: function definitions (`function`), function prototypes
    (`function` + `declaration` decorator), function-like macros
    (`function` + `macro` + `function_like`), `struct` / `union`
    definitions (`class` + `struct` / `union` decorator), `enum`
    definitions (`enum`), `typedef` aliases (`type` + `typedef`), object
    -like macros (`constant` + `macro`), global variables (`variable`),
    global `const` definitions (`constant` + `const`), struct / union
    fields (`variable` + `field`), function-pointer struct fields
    (`method` + `field` + `function_pointer`), and enum constants
    (`constant` + `enum_constant`). Storage / type qualifier modifiers
    (`static`, `inline`, `extern`, `const`, `volatile`, `_Atomic`,
    `register`, MSVC `__declspec(...)`) are surfaced as the symbol's
    `decorators` list. `typedef struct { … } Foo;` emits both an inline
    anonymous struct named `Foo` and the typedef alias `Foo`.
  - **References**: every `call_expression` inside a function body
    becomes a `calls` edge. Direct calls keep the bare identifier; calls
    through a field (`obj->foo()` / `obj.foo()`) keep the dotted form;
    parenthesized callees (`(*fp)(args)`) unwrap to the inner callee.
    Duplicate calls per caller are folded into a single edge.
  - **Imports**: `#include "x.h"` and `#include <stdio.h>` both surface
    as wildcard imports (`isWildcard: true`, `names: []`). System
    includes keep the literal angle brackets in `module` so
    `resolveImportPath` can distinguish them and return no candidates.
  - **Preprocessor-conditional containers** are walked transparently:
    declarations buried inside `#ifndef HEADER_H` guards, `#if defined`
    / `#elif` / `#else` platform branches, and `extern "C" { … }`
    linkage specifications are all surfaced uniformly.
  - **Qualified names** are derived from the file path with POSIX
    separators converted to dots and the extension stripped: `src/util.c`
    → module `src.util`, `add` → `src.util.add`. Struct fields and enum
    constants nest under their parent's qualified name.
  - **Exports** list every linker-visible definition emitted by this
    translation unit: non-`static` function definitions, plus non -`static` global variable / const definitions. Macros (preprocessor
    -only), typedefs / structs / enums (type-level), prototypes
    (`declaration`), and members are intentionally excluded.

  `resolveImportPath` converts a `#include` path to candidate files
  relative to repo root: a quoted include from `src/main.c` like
  `"util.h"` returns `["src/util.h", "util.h"]` (file-relative first,
  repo-root second, deduped when they coincide); `"../shared/util.h"`
  returns `["shared/util.h", "../shared/util.h"]`; `<stdio.h>` returns
  `[]` (system header — unknown roots). The resolver does not consult
  `compile_commands.json` — project-level include search paths are a
  graph-builder concern. A shared `lang-c-core` for the resolver will be
  extracted when `lang-cpp` lands.

  The complex test tier is a SHA-pinned snapshot of cJSON 1.7.18 at
  commit `acc76239bee01d8e9c858ae2cab296704e52d916` (MIT) — four files
  (~145 KB of C exercising typedefs, enums, function-pointer fields,
  macros, header guards, and `extern "C"` blocks). Invariant-based
  assertions pin floor counts (≥ 100 functions, ≥ 10 types, ≥ 20 macros,
  ≥ 200 symbols, ≥ 5 includes, ≥ 300 references) plus landmark API
  symbols (`cJSON_Parse`, `cJSON_Print`, `cJSON_Delete`, `cJSON_*` type
  macros, the `cJSONUtils_*` helper family).

  Bundle: 40.14 KB raw (50 KB budget). Coverage: 96.38% statement /
  80.07% branch / 97.05% function on `extractor.ts`.

- 4d3a54d: Refactor: extract the C extraction core (`CFamilyExtractor`, `createCFamilyOutline`, `resolveCInclude`, declarator / path / doxy helpers) into a new workspace-internal package `@reponova/lang-c-core`. The package is `"private": true` and never published; `@reponova/lang-c` bundles it inline via `tsup --noExternal` so the published tarball is fully self-contained.

  This change is invisible to consumers of `@reponova/lang-c`:

  - the `LanguagePlugin` shape is unchanged (`id: "c"`, extensions `[".c", ".h"]`, `wasmFile: "tree-sitter-c.wasm"`),
  - extraction output (`symbols`, `imports`, `references`, `exports`) is byte-for-byte identical for every existing fixture (simple greeter, medium cache, complex cJSON 1.7.18),
  - `resolveImportPath` semantics are preserved (delegating to the new standalone `resolveCInclude`),
  - published `dist/index.d.ts` keeps re-exporting `CFamilyExtractor` (renamed from `CExtractor`) — the alias is available alongside.

  The motivation is to let the upcoming `@reponova/lang-cpp` plugin reuse the C subset of extraction (functions, structs/unions/enums, typedefs, macros, globals, the `#include` resolver, the preproc-conditional walker, declarator helpers) instead of duplicating ~970 LOC. C++ subclasses `CFamilyExtractor` and overrides `dispatchTopLevel` to add namespace / class / template / using handling on top of the C subset, chaining back via `super.dispatchTopLevel`.

  The existing C fixture suite (simple, medium, complex / cJSON) and 35 extractor unit tests + 10 resolver / helpers unit tests now live in `@reponova/lang-c-core`. `@reponova/lang-c` keeps a 5-test plugin-shape smoke suite verifying the published `LanguagePlugin` contract. Coverage gate on `extractor.ts` lands at 97.33%; bundle size at 40.91 KB / 50 KB budget.
