# @reponova/lang-cpp

## 0.1.0

### Minor Changes

- db9f630: Add C++ language plugin: `@reponova/lang-cpp` extracts symbols, imports, and references from C++ source files (`.cpp` / `.cc` / `.cxx` / `.c++` / `.hpp` / `.hh` / `.hxx` / `.h++`) using the official `tree-sitter-cpp` v0.23.4 WASM grammar.

  The extractor subclasses `CFamilyExtractor` from the workspace-internal `@reponova/lang-c-core` (bundled inline via `tsup --noExternal`) and inherits the entire C subset (functions, structs / unions / enums, typedefs, macros, globals, `#include` resolver, preprocessor-conditional walker, Doxygen docstring parsing). On top of that it adds C++-specific dispatch:

  - **Namespaces** (including nested and anonymous) — surfaced as `module`-kind symbols with the qualified path extended through every level.
  - **Classes and structs with access modifiers** — `public` / `protected` / `private` tracked across the member list; default `private` for `class`, `public` for `struct`.
  - **Inheritance** — each base in `class Derived : public Base, protected Mixin { … }` produces an `extends` reference.
  - **Templates** — `template <typename T> class Foo { … }` and templated free functions are tagged with the `template` decorator and a `template<…>` signature prefix.
  - **Constructors, destructors, operator overloads** — each tagged with `ctor` / `dtor` / `operator` decorators alongside the access modifier.
  - **Out-of-class definitions** — `int Foo::bar() { … }` and templated container forms (`Cache<K, V>::put`) are emitted with `parent` set to the class qualified name so they line up with their in-class declaration when the graph builder joins by qualified name.
  - **`using` declarations and `using namespace` directives** — named imports vs wildcard imports.
  - **Alias declarations** — `using IntVec = std::vector<int>;` produces a `type`-kind symbol with the `alias` decorator.

  Quality gates:

  - 55 unit + fixture tests (33 inline extractor cases + 8 resolve-imports + 14 fixtures), all passing.
  - Fixture suite covers simple (single namespace + class + free function), medium (templates, inheritance, ctors / dtors / operator overloads, alias, out-of-class definitions), and complex (`magic_enum` v0.9.7 — 9 headers, ~3,600 LOC of modern C++17 template metaprogramming, MIT licensed, verbatim snapshot + ATTRIBUTION).
  - `tree-sitter-cpp` v0.23.4 grammar pinned by SHA-256 in `tools/grammar-fetcher/grammars.json`.
  - Bundle size: 74.51 KB / 100 KB budget.
  - Coverage: `extractor.ts` lines 94.32% / branches 80% (gate ≥ 80%).
