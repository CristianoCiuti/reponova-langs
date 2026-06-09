# @reponova/lang-c-core

Internal workspace package. Hosts the shared C-family extractor and outline used by:

- [`@reponova/lang-c`](../lang-c) — `.c` / `.h` files via `tree-sitter-c.wasm`
- [`@reponova/lang-cpp`](../lang-cpp) — `.cpp` / `.cc` / `.cxx` / `.hpp` / `.h++` files via `tree-sitter-cpp.wasm`

Both consumer plugins import the same `CFamilyExtractor` class and `createCFamilyOutline` factory and pass language-specific configuration (id, extensions, wasm filename) at construction time. The C++ plugin additionally extends `CFamilyExtractor` to handle namespaces, classes (with access modifiers + bases), templates, constructors / destructors, and `using` declarations. Both plugins bundle this package inline via `tsup --noExternal`, so consumers of the published npm tarballs see no trace of `@reponova/lang-c-core` (it is never published).

## Why a separate workspace package?

The C and C++ grammars from upstream `tree-sitter/tree-sitter-{c,cpp}` overlap on the C subset but diverge at the C++ feature boundary (namespaces, classes, templates, …). The reponova `LanguagePlugin` contract binds **one** `LanguageExtractor` (with one `wasmFile`) per plugin, so two plugins are needed. Sharing the C extraction logic in a workspace package (rather than copy-pasting ~970 LOC) keeps the two plugins in lock-step on bug fixes, fixture infrastructure, and the `#include` resolver.

## Layout

```
src/
  extractor.ts   # CFamilyExtractor (configurable, subclassable)
  outline.ts     # createCFamilyOutline + default `c` LanguageSupport
  index.ts       # public barrel
tests/
  extractor.test.ts
  resolve-imports.test.ts
  fixtures.test.ts
  fixtures/
    simple/      # 2-file greeter (.c + .h)
    medium/      # 2-file cache (.c + .h) with typedefs, function pointers, macros
    complex/     # OSS snapshot pinned at a specific commit (cJSON 1.7.18)
```

## Public API

```ts
import {
  CFamilyExtractor,
  type CFamilyExtractorOptions,
  createCFamilyOutline,
  c, // default LanguageSupport (C-flavored, bound to tree-sitter-c.wasm)

  // Standalone utilities for non-extractor callers:
  resolveCInclude,
  findFunctionDeclarator,
  extractDeclaratorName,
  filePathToModule,
} from "@reponova/lang-c-core";
```

The C++ plugin subclasses `CFamilyExtractor` and overrides `dispatchTopLevel` (chaining back via `super.dispatchTopLevel`) to add namespace / class / template / using handling on top of the C subset.

## Not published to npm

Marked `"private": true`. CI hard-fails any attempt to publish it. Distribution to end users happens through `@reponova/lang-c` and `@reponova/lang-cpp` tarballs, which inline this code at build time.
