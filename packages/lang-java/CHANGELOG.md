# @reponova/lang-java

## 0.1.0

### Minor Changes

- e3ca6f8: Add Java language support (`.java`) backed by the official
  `tree-sitter-java` v0.23.5 WASM grammar. Third package in the Priority
  pack (ROADMAP §6.1), first Archetype-A entry after Mermaid (B) and SQL
  (B). The extractor handles modern Java syntax up to and including
  Java 21:

  - **Symbols**: top-level + nested classes (`class`), interfaces
    (`interface`), enums (`enum`), records (`class` + `record`
    decorator), annotation interfaces (`interface` + `annotation`
    decorator), constructors / methods (`method`), fields (`variable`
    / `constant` for `static final`), enum constants, record
    components (with the `record_component` decorator), and annotation
    type elements. Modifier keywords (`public` / `private` /
    `protected` / `static` / `final` / `abstract` / `default` /
    `synchronized` / `native` / `sealed` / `non-sealed`) and
    annotations (`@Override`, `@SuppressWarnings("x")`,
    `@java.lang.Deprecated`, …) are surfaced as the symbol's
    `decorators` list.
  - **References**: every `extends` and `implements` clause becomes an
    `extends` edge; every `method_invocation` (qualified or not) and
    `object_creation_expression` (`new Foo(...)`) inside a method or
    constructor body becomes a `calls` edge.
  - **Imports**: type imports (`import a.b.Cls`) surface as
    `{ module: "a.b", names: ["Cls"] }`. Static imports
    (`import static a.b.Cls.member`) surface as
    `{ module: "a.b.Cls", names: ["member"] }`. Wildcard imports
    (`import a.b.*` / `import static a.b.Cls.*`) keep the full prefix
    in `module` with `isWildcard: true`.
  - **Qualified names** are driven by the `package` declaration, not
    by the on-disk file path — Java source roots (`src/main/java`,
    custom Maven/Gradle layouts) are project-level concerns.
  - **Exports** list every top-level `public` type in the file (the
    package-private and nested types stay implicit).

  `resolveImportPath` converts a dotted import path into candidate
  `<dotted>.java` files relative to repo root. It strips the trailing
  lowercase segment of a static-import path so
  `java.util.Collections.emptyList` resolves to
  `java/util/Collections.java`. Wildcard imports return no candidate
  (no single file is meant) and let the graph builder match by package
  directory.

  The complex test tier is a SHA-pinned snapshot of Apache Commons CLI
  1.9.0 at commit `698b238276c0e22e97e4aec703a0b00201d29666` (Apache
  License 2.0) — 26 files, ~239 KB of canonical OOP-heavy Java
  covering exception hierarchies, builder patterns, the
  `CommandLineParser` strategy interface, and a 41 KB `HelpFormatter`.
  Invariant-based assertions pin floor counts (≥ 20 types, ≥ 200
  methods, ≥ 500 symbols, ≥ 40 imports, ≥ 500 references) plus
  landmark types (`Option`, `Options`, `CommandLine`, `DefaultParser`,
  `HelpFormatter`, `Converter`, the `*Parser` strategy classes, and
  the `ParseException` → `Exception` hierarchy).

  Bundle: 31.45 KB raw (50 KB budget). Coverage: 98.83% statement /
  85.92% branch / 100% function on `extractor.ts`.
