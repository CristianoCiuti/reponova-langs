# @reponova/lang-java

Java language support for [RepoNova](https://github.com/CristianoCiuti/reponova), backed by the official [`tree-sitter-java`](https://github.com/tree-sitter/tree-sitter-java) v0.23.5 WASM grammar. Handles modern Java up to and including Java 21 (records, sealed types, pattern matching, switch expressions).

## Install

```bash
reponova lang add @reponova/lang-java
```

## What it extracts

The extractor walks the tree-sitter AST and emits one of:

### Symbols (with first decorator family tag)

| Java construct | `SymbolNode.kind` | Notable decorators |
| --- | --- | --- |
| `class` declaration (incl. nested) | `class` | `public` / `private` / `protected`, `final`, `abstract`, `sealed`, `non-sealed`, `static` (for nested), plus every annotation |
| `record` declaration | `class` | `record` (always first), modifiers, annotations |
| `interface` declaration | `interface` | modifiers, annotations |
| `@interface` declaration (annotation interface) | `interface` | `annotation` (always first) |
| `enum` declaration | `enum` | modifiers, annotations |
| Method | `method` | `Override` / `Deprecated` / …, `public` / `private` / `protected`, `static`, `final`, `abstract`, `default`, `synchronized`, `native` |
| Constructor | `method` | `constructor` (always first), modifiers |
| Annotation type element (`String value() default "";`) | `method` | `annotation_element` |
| Field (one symbol per `variable_declarator`) | `variable` | modifiers, annotations |
| Field — `static final` | `constant` | modifiers, annotations |
| Enum constant | `constant` | `enum_constant` |
| Record component | `variable` | `record_component` |

### Cross-references

| Source | Target | `SymbolReference.kind` |
| --- | --- | --- |
| `extends` clause on `class` / `interface` / `record` | superclass / super-interface | `extends` |
| `implements` clause on `class` / `enum` / `record` | implemented interface | `extends` |
| `method_invocation` inside method / constructor body (`foo()`, `obj.method()`, `Cls.bar()`) | callee | `calls` |
| `object_creation_expression` (`new Foo()` / `new Foo<T>()`) | type | `calls` |

Generic argument lists are stripped from heritage targets (`BaseService<User>` → `BaseService`), so the graph edge points at the bare type. Method invocations preserve the receiver text in the call name (`obj.method`, `Cls.method`, `System.out.println`) so the graph builder can match against either qualified or unqualified call sites.

### Imports

| Form | `module` | `names` | `isWildcard` |
| --- | --- | --- | --- |
| `import a.b.Cls;` | `"a.b"` | `["Cls"]` | `false` |
| `import a.b.*;` | `"a.b"` | `[]` | `true` |
| `import static a.b.Cls.member;` | `"a.b.Cls"` | `["member"]` | `false` |
| `import static a.b.Cls.*;` | `"a.b.Cls"` | `[]` | `true` |

`ImportDeclaration` does not carry an `isStatic` flag (the core type doesn't expose one), but the static / non-static distinction is recoverable by checking whether `module` ends in a `PascalCase` segment.

## Extensions

`.java`

## Configuration

In `reponova.yml`:

```yaml
plugins:
  java:
    enabled: true       # default: true
    parse: true         # default: true — parse Java content to extract symbols
    # patterns: []      # override global patterns for Java files
    # exclude: []       # override global exclude for Java files
```

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Enable / disable Java file detection and extraction |
| `parse` | boolean | `true` | Parse Java content to extract symbols and relationships |
| `patterns` | string[] | `[]` | Glob patterns to override global file matching for this plugin |
| `exclude` | string[] | `[]` | Glob patterns to override global exclusions for this plugin |

## Resolution semantics

- **Qualified names** are driven by the `package` declaration, not by the on-disk file path. A class `UserService` declared as `package com.example.api;` becomes `com.example.api.UserService` regardless of whether it lives under `src/main/java/`, `app/`, or a custom Maven / Gradle layout. Files without a `package` declaration produce unqualified names.
- **Inner types** are qualified through the full parent chain: `package x; class Outer { class Mid { class Inner {} } }` → `x.Outer.Mid.Inner`.
- **`resolveImportPath`** converts a dotted import to a candidate `.java` file relative to repo root. The graph builder matches by trailing-suffix against extracted file paths, so it works for `src/main/java/`, `src/test/java/`, and custom layouts without configuration.
  - `com.example.foo.Bar` → `["com/example/foo/Bar.java"]`
  - `java.util.Collections.emptyList` (static import) → `["java/util/Collections.java"]` (the trailing lowercase segment is dropped because it's a member, not a type)
  - `com.example.util.*` (wildcard) → `[]` (no single candidate file)
- **Exports**: the file's `exports` list contains every top-level type declared with the `public` modifier. Package-private types (Java's default-visibility), nested types, and annotation type elements are intentionally left implicit.
- **Function bodies**: PL/pgSQL-style intra-function symbol extraction is out of scope. We capture method-invocation and constructor-creation expressions inside method / constructor bodies as `calls` edges; lambda bodies, anonymous classes, and local classes are walked transitively but their nested calls roll up to the enclosing method.

## Grammar

`tree-sitter-java` v0.23.5 (commit pinned by SHA-256 in `tools/grammar-fetcher/grammars.json`). The `.wasm` blob is downloaded at build time and shipped inside the published npm tarball, so consumers never need to manage grammar binaries.

## License

MIT — see [LICENSE](./LICENSE).
