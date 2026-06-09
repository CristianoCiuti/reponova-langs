# @reponova/lang-cpp

C++ language support for [RepoNova](https://github.com/CristianoCiuti/reponova), backed by the official [`tree-sitter-cpp`](https://github.com/tree-sitter/tree-sitter-cpp) v0.23.4 WASM grammar. Handles modern C++ (≤ C++20) constructs: namespaces, classes / structs with access modifiers and inheritance, templates, constructors / destructors, operator overloads, `using` declarations and alias declarations, plus the full C subset inherited from `@reponova/lang-c-core`.

## Install

```bash
reponova lang add @reponova/lang-cpp
```

## What it extracts

The extractor walks the tree-sitter AST and emits one of:

### C++ symbols

| C++ construct | `SymbolNode.kind` | Notable decorators |
| --- | --- | --- |
| `namespace foo { … }` | `module` | `namespace` |
| `class Foo { … }` | `class` | `class`, plus `template` if templated |
| `struct Foo { … }` | `class` | `struct`, plus `template` if templated |
| Class / struct method declaration | `method` | `public`/`protected`/`private`, `declaration`, plus modifiers (`const`, `virtual`, `static`, `inline`, …) |
| Inline method definition | `method` | access, plus modifiers; `ctor` / `dtor` / `operator` when applicable |
| Class field (`int x_;`) | `variable` | access, `field` |
| Class `const` field | `constant` | access, `field`, `const` |
| Function-pointer field (`int (*fp_)(int);`) | `method` | access, `field`, `function_pointer` |
| Out-of-class definition (`int Foo::bar() { … }`) | `method` | `out_of_class`, plus modifiers |
| Templated free function | `function` | `template`, plus modifiers |
| Templated class / struct | `class` | `class`/`struct`, `template` |
| `using Counter = int;` (alias) | `type` | `alias` |

Anonymous namespaces (`namespace { … }`) keep the outer scope rather than being emitted as their own symbol — their contents still appear with the parent's qualified path, matching how C++ ODR treats them.

### C subset (inherited)

`@reponova/lang-cpp` extends `@reponova/lang-c` and reuses the entire C extraction layer: function definitions, function prototypes, function-like and object-like macros, structs / unions / enums, typedefs, global variables, `#include` resolution, preprocessor-conditional walker (`#ifdef` / `#if` / `extern "C"`), and Doxygen-style docstring parsing. See [`@reponova/lang-c`'s README](../lang-c/README.md) for the canonical list of decorators and edge cases.

### Cross-references

| Source | Target | `SymbolReference.kind` |
| --- | --- | --- |
| `class Derived : public Base, protected Mixin { … }` | each base | `extends` (one per base) |
| `call_expression` inside any function / method body | callee identifier | `calls` |

### Imports

| Form | `module` | `names` | `isWildcard` |
| --- | --- | --- | --- |
| `#include <vector>` | `<vector>` (literal angle brackets) | `[]` | `true` |
| `#include "util.hpp"` | `util.hpp` | `[]` | `true` |
| `using std::cout;` | `std` | `["cout"]` | `false` |
| `using namespace std;` | `std` | `[]` | `true` |
| `using namespace foo::bar;` | `foo.bar` | `[]` | `true` |

### Out-of-class definitions

`int Foo::bar() { … }` in a `.cpp` file is emitted as a `method`-kind symbol with `parent="<module>.Foo"` and `qualifiedName="<module>.Foo.bar"`. Multi-level qualifiers (`int ns::Cls::bar() { … }`) and templated containers (`Cache<K, V>::put`) are both supported — the template arguments are stripped from the qualifier path so the resulting qualified name matches the in-class declaration emitted from the header.

## Extensions

`.cpp`, `.cc`, `.cxx`, `.c++`, `.hpp`, `.hh`, `.hxx`, `.h++`

## Configuration

In `reponova.yml`:

```yaml
plugins:
  cpp:
    enabled: true       # default: true
    parse: true         # default: true — parse C++ content to extract symbols
    # patterns: []      # override global patterns for C++ files
    # exclude: []       # override global exclude for C++ files
```

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Enable / disable C++ file detection and extraction |
| `parse` | boolean | `true` | Parse C++ content to extract symbols and relationships |
| `patterns` | string[] | `[]` | Glob patterns to override global file matching for this plugin |
| `exclude` | string[] | `[]` | Glob patterns to override global exclusions for this plugin |

## Resolution semantics

- **Qualified names** are derived from the file path joined with the namespace / class scope. `src/util.cpp` → module `src.util`; `namespace acme::cache { class Cache { … }; }` produces `src.util.acme.cache.Cache`. Class members nest one further level: `src.util.acme.cache.Cache.put`.
- **Access modifiers** are tracked across the class body by walking `field_declaration_list` children in source order. Each emitted member carries the current access (`public`, `protected`, `private`) as a decorator. Default access is `private` for `class`, `public` for `struct`.
- **Inheritance** is surfaced as `extends` references from the derived class to each base. The access prefix (`public Base`) is not preserved separately — consumers can read it from the class signature if needed.
- **Templates** are unwrapped one level: a `template <typename T>` wrapping a `class Foo` produces a single `Foo` class symbol with the `template` decorator and the parameter list prefixed to the signature (`template<typename T> class Foo`). Templated free functions are handled identically.
- **`resolveImportPath`** is identical to `@reponova/lang-c`'s — same `<…>` vs `"…"` semantics, same resolution candidates (file-relative first, repo-root second).
- **Exports** include every top-level non-`static` function, variable, constant, namespace, and class. `static` storage and macros are excluded, mirroring C linkage rules. Class members and namespace contents are not surfaced as exports — their visibility flows through the enclosing scope.
- **Call edges** are intra-function only. A method `foo()` calling another method via `this->bar()` produces an edge to `this.bar`; calling a free function by name produces an edge to that name; calls through pointers / member-access expressions are surfaced with their textual form.

## Grammar

`tree-sitter-cpp` v0.23.4 (commit pinned by SHA-256 in `tools/grammar-fetcher/grammars.json`). The `.wasm` blob is downloaded at build time and shipped inside the published npm tarball, so consumers never need to manage grammar binaries.

## Workspace internals

The extraction core (`CFamilyExtractor`) is shared with `@reponova/lang-c` via the workspace-internal `@reponova/lang-c-core` package. `@reponova/lang-cpp` subclasses `CFamilyExtractor` and adds C++-specific dispatch on top of the inherited C subset. The core package is bundled inline at build time (via `tsup --noExternal`), so the published tarball is fully self-contained and consumers never depend on a private package.

## License

MIT — see [LICENSE](./LICENSE).
