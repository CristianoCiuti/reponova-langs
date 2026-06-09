# @reponova/lang-c

C language support for [RepoNova](https://github.com/CristianoCiuti/reponova), backed by the official [`tree-sitter-c`](https://github.com/tree-sitter/tree-sitter-c) v0.24.2 WASM grammar. Handles C99 / C11 / C17 features (typedefs, function pointers, anonymous structs / unions, `_Atomic`, `_Thread_local`, MSVC `__declspec`, GCC attributes) and walks transparently through preprocessor-conditional containers (`#ifdef HEADER_H`, `#if defined(__linux__)`, `extern "C" { … }`).

## Install

```bash
reponova lang add @reponova/lang-c
```

## What it extracts

The extractor walks the tree-sitter AST and emits one of:

### Symbols (with first decorator family tag)

| C construct | `SymbolNode.kind` | Notable decorators |
| --- | --- | --- |
| Function definition (`int foo(int x) { … }`) | `function` | `static`, `inline`, `extern`, `const`, `volatile`, `_Atomic`, MSVC `__declspec(...)` |
| Function prototype (`extern int foo(int);`) | `function` | `declaration` (always present), plus any storage / qualifier modifiers |
| Function-like macro (`#define MAX(a,b) …`) | `function` | `macro`, `function_like` |
| `struct X { … }` (with body) | `class` | `struct`, plus per-field children |
| `union X { … }` (with body) | `class` | `union`, plus per-field children |
| `enum X { … }` (with body) | `enum` | none — enumerators emit as children |
| `typedef T A;` (any form) | `type` | `typedef` |
| Object-like macro (`#define MAX 16`) | `constant` | `macro` |
| Global variable definition | `variable` | storage / qualifier modifiers |
| Global `const` definition | `constant` | `const`, plus other qualifiers |
| Struct / union field | `variable` | `field` |
| Struct / union function-pointer field (`int (*on_open)(int);`) | `method` | `field`, `function_pointer` |
| Enum constant | `constant` | `enum_constant` |

`typedef struct { … } Foo;` emits two symbols: the inline anonymous struct surfaces as a `class` named `Foo`, and the typedef alias surfaces as a `type` named `Foo`. The same shape applies to `typedef enum { … } Foo;`.

### Cross-references

| Source | Target | `SymbolReference.kind` |
| --- | --- | --- |
| `call_expression` inside a function body — direct (`foo()`) | callee identifier | `calls` |
| `call_expression` inside a function body — through a field (`obj->foo()` / `obj.foo()`) | dotted form (`obj.foo`) | `calls` |
| `call_expression` through a parenthesized callee (`(*fp)(args)`) | the unwrapped callee text | `calls` |

Duplicates are folded — three calls to `foo()` from the same caller produce a single `calls` edge.

### Includes

| Form | `module` | `names` | `isWildcard` |
| --- | --- | --- | --- |
| `#include <stdio.h>` (system) | `<stdio.h>` (literal angle brackets preserved) | `[]` | `true` |
| `#include "util.h"` (user) | `util.h` | `[]` | `true` |
| `#include "../shared/util.h"` (user, relative) | `../shared/util.h` | `[]` | `true` |

`#include` is modelled as a wildcard import: a header brings every public symbol in scope, just like `from x import *` in Python or `import a.b.*;` in Java.

## Extensions

`.c`, `.h`

## Configuration

In `reponova.yml`:

```yaml
plugins:
  c:
    enabled: true       # default: true
    parse: true         # default: true — parse C content to extract symbols
    # patterns: []      # override global patterns for C files
    # exclude: []       # override global exclude for C files
```

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Enable / disable C file detection and extraction |
| `parse` | boolean | `true` | Parse C content to extract symbols and relationships |
| `patterns` | string[] | `[]` | Glob patterns to override global file matching for this plugin |
| `exclude` | string[] | `[]` | Glob patterns to override global exclusions for this plugin |

## Resolution semantics

- **Qualified names** are derived from the file path with POSIX separators converted to dots and the extension stripped: `src/util.c` → module `src.util`, `add` → `src.util.add`. Struct fields and enum constants nest under their parent type's qualified name: `src.util.Point.x`, `src.util.Color.RED`.
- **Preprocessor-conditional containers** (`#ifndef HEADER_H`, `#if defined(__linux__)`, `#elif`, `#else`, `extern "C" { … }`) are walked transparently — declarations buried inside header guards and platform branches are still surfaced. Symbols from every branch are emitted so the graph reflects the combined public surface across build configurations.
- **`resolveImportPath`** converts a `#include` path to candidate files relative to repo root. The graph builder matches by trailing-suffix against extracted file paths.
  - `"util.h"` from `src/main.c` → `["src/util.h", "util.h"]` (file-relative first, repo-root second for `-I include/` style layouts; deduped when they coincide)
  - `"../shared/util.h"` from `src/main.c` → `["shared/util.h", "../shared/util.h"]`
  - `<stdio.h>` → `[]` (system includes are not resolved — we don't know the system header roots)
- **Exports**: the file's `exports` list contains every linker-visible definition emitted by this translation unit: non-`static`, non-`extern`, non-`declaration` function definitions, plus non-`static` global variable / global `const` definitions. Macros (preprocessor-only), typedefs / structs / enums (type-level concepts), prototypes (`declaration`), and members are intentionally excluded.
- **Call edges**: only intra-function `call_expression` nodes produce `calls` references. Type references in function signatures, field accesses, and `sizeof` operands are intentionally not surfaced — they would explode the graph for negligible signal.
- **Doxygen docstrings**: `/** … */`, `/*! … */`, and contiguous `///` line-comment groups immediately preceding a declaration become its `docstring`. A leading `/* … */`, `///`, or `//` at file head becomes the file-level `docstring`. Plain `/* … */` block comments preceding a declaration are *not* treated as docstrings (Doxy-only).

## Grammar

`tree-sitter-c` v0.24.2 (commit pinned by SHA-256 in `tools/grammar-fetcher/grammars.json`). The `.wasm` blob is downloaded at build time and shipped inside the published npm tarball, so consumers never need to manage grammar binaries.

## License

MIT — see [LICENSE](./LICENSE).
