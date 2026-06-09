# Language Plugin Roadmap

> Architecture baseline and forward-looking integration tiers for the `@reponova/lang-*` plugin suite hosted in this monorepo.

This document is meant to stay valid across every wave of new language plugins.
It assumes the monorepo's architecture as **given** (not up for re-discussion) and focuses on the
process and tiers used to grow the suite of supported languages.

For end-user setup and the developer workflow see [`README.md`](./README.md) and
[`CONTRIBUTING.md`](./CONTRIBUTING.md). For grammar internals see
[`tools/grammar-fetcher/README.md`](./tools/grammar-fetcher/README.md). For release internals
see [`tools/bootstrap-plugin/README.md`](./tools/bootstrap-plugin/README.md) and
[`tools/trust-configure/README.md`](./tools/trust-configure/README.md).

## Table of contents

1. [Goals](#1-goals)
2. [Architecture baseline](#2-architecture-baseline)
3. [Plugin archetypes](#3-plugin-archetypes)
4. [How a new language plugin is added](#4-how-a-new-language-plugin-is-added)
5. [Cross-cutting standards](#5-cross-cutting-standards)
6. [Integration tiers](#6-integration-tiers)
7. [Operating principles](#7-operating-principles)

---

## 1. Goals

- Grow RepoNova's language coverage **without** changing the plugin contract.
- Keep every plugin independently versioned, independently published, and independently
  installable by end users (`reponova lang add @reponova/lang-<id>`).
- Make adding a new language a **mechanical, low-risk process** with predictable effort:
  scaffold → implement extractor → fixtures → release.

## 2. Architecture baseline

The architecture is **stable**: the items below are assumed by every existing and future plugin.

### 2.1 Plugin contract

Every official plugin is a regular npm package that satisfies four requirements:

1. `package.json.reponova.type === "language"`.
2. `package.json.reponova.extensions` is a non-empty `string[]` — the single source
   of truth for which files the plugin handles, read by reponova at load time and
   by `reponova lang suggest` against the npm registry.
3. `package.json.keywords` includes `"reponova-language"` so the plugin is
   discoverable on the npm registry.
4. The entry point exports a `plugin` (or `default`) object conforming to
   `LanguagePlugin`. The plugin is **explicitly declared** by the consumer in
   `reponova.yml` under `plugins:` and installed via `reponova lang add <pkg>`
   (or interactively via `reponova lang suggest`). There is no filesystem
   auto-scanning at runtime.

```typescript
interface LanguagePlugin {
  readonly id: string;                       // e.g. "rust"
  readonly fileType?: string;                // bucket in detected-files.json (defaults to id)
  readonly grammarPath?: string;             // absolute path to a tree-sitter .wasm
  readonly extractor: LanguageExtractor;     // mandatory
  readonly outline?: LanguageSupport;        // optional but recommended for Tier 1
  readonly configDefaults?: Record<string, unknown>;
}

interface LanguageExtractor {
  readonly languageId: string;
  readonly wasmFile?: string;                // omitted = regex-based extraction
  extract(tree: SyntaxTree | null, sourceCode: string, filePath: string): FileExtraction;
  resolveImportPath(importModule: string, currentFilePath: string): string[];
}

interface FileExtraction {
  filePath: string;
  language: string;
  fileNode: FileNodeDeclaration;
  symbols: SymbolNode[];
  imports: ImportDeclaration[];
  references: SymbolReference[];
  exports?: string[];
}
```

### 2.2 Edge vocabulary

All plugins reuse the same edge types: `calls`, `imports`, `imports_from`, `extends`, `contains`.
New edge types are not introduced lightly — when a language has a concept that does not map
naturally onto these (e.g. `implements`, `uses`, `references`), the recommended path is to
project it onto the existing vocabulary (e.g. `implements` → `extends`) rather than fork it.
A genuine new edge type requires a coordinated PR on `reponova` core.

### 2.3 Monorepo layout

```
reponova-langs/
  packages/
    lang-<id>/             # one published @reponova/lang-* per language or asset type
    lang-test-utils/       # internal: shared test helpers (private)
    lang-typescript-core/  # internal: shared TS/JS/TSX extractor core (private)
    lang-c-core/           # internal: shared C/C++ extractor core (private)
  tools/
    scaffold/              # internal: `pnpm scaffold lang-<id>`
    grammar-fetcher/       # internal: pinned download + SHA-256 verify
    trust-configure/       # internal: bulk npm OIDC Trusted Publisher setup
    bootstrap-plugin/      # internal: first-publish helper for brand-new plugins
  .changeset/
  .github/workflows/
    ci.yml                 # typecheck + lint + build + test + coverage + size
    release.yml            # changesets-driven OIDC publish per package
```

`packages/*` and `tools/*` are pnpm workspaces. Internal packages (`scaffold`, `lang-test-utils`,
`lang-typescript-core`, `lang-c-core`, `grammar-fetcher`, `trust-configure`, `bootstrap-plugin`)
are `"private": true` and never published.

### 2.4 Grammar pipeline

- Tree-sitter grammars are exclusively `web-tree-sitter` (WASM). No native bindings.
- `.wasm` binaries are **not committed to git**. They are pinned in
  [`tools/grammar-fetcher/grammars.json`](./tools/grammar-fetcher/grammars.json) by upstream
  `tag` + `sha256` + `size`. That manifest is the single source of truth.
- `pnpm grammar-fetch` downloads from upstream GitHub releases, **verifies SHA-256**, and
  refuses to write a mismatching file. Plugins that ship a grammar invoke it in their
  `prebuild` and `pretest` hooks so a clean clone builds and tests without manual steps.
- The `.wasm` files **are** included in the published npm tarball (under each plugin's
  `grammars/` and listed in `files`). End users get a self-contained install — no network
  round-trip, no host-side build step.

### 2.5 Release pipeline

- Versioning and changelogs are managed via [Changesets](https://github.com/changesets/changesets).
- Each `@reponova/lang-*` package on npmjs.com is configured with a GitHub Actions OIDC
  Trusted Publisher pointing at this repo's `release.yml`. **No long-lived `NPM_TOKEN`
  secrets exist in CI.**
- The release workflow runs three jobs in order: `versioning` → `detect` → `publish`. The
  publish job is a `fail-fast: false` matrix with one cell per package; a failure on one
  package never blocks the others, and every step (npm publish / git tag / GitHub Release)
  is idempotent.
- The first publish of a brand-new plugin is bootstrapped by `pnpm bootstrap-plugin lang-<id>`,
  which performs the one-time chicken-and-egg dance between Trusted Publisher configuration
  and the first OIDC publish. From then on every release is fully automated.

### 2.6 Quality gates

Every push and PR runs (per package, where applicable):

- `pnpm typecheck` — TypeScript strict, zero errors.
- `pnpm lint` — ESLint baseline.
- `pnpm build` — `tsup` ESM + `.d.ts`.
- `pnpm test` — vitest, all green.
- `pnpm test:coverage` — `>= 80%` lines/branches/functions/statements on `src/extractor.ts`.
- `pnpm size` — bundle size limit on the built artefact (`@size-limit/file`):
  plugins without WASM `< 50 KB`, plugins with WASM `< 2.5 MB` including the bundled grammar.

These gates are enforced in CI (`.github/workflows/ci.yml`) on Linux + Node 22 and **gate
the version PR**: a failing gate blocks the release.

## 3. Plugin archetypes

Every new language plugin falls into one of three archetypes already present in the suite.
The archetype dictates the parsing strategy, the `fileNode.kind`, and the typical effort
budget.

| Archetype | Description | Parsing | `fileNode.kind` | Typical extracts |
|---|---|---|---|---|
| **A** — Programming language | Functions, classes, methods, imports, calls. | tree-sitter WASM (recommended) or regex fallback | `module` | `function`, `class`, `method`, `interface`, `enum`, `variable`, `constant`, calls, inheritance |
| **B** — Diagramming / DSL | Entity + relationship languages where the graph is the artefact itself (e.g. PlantUML, Mermaid, DBML). | regex (no WASM) | `diagram` | entities → symbols, relationships → `extends` edges |
| **C** — Visual / textual asset | Mostly-presentational artefacts where parseable text content is the symbol surface (e.g. SVG). | regex (no WASM) | `diagram` | text content → `section` symbols, titles → docstrings |

### Configuration archetype (sub-variant of A or B)

Configuration formats (JSON/JSONC, YAML, TOML, Dockerfile, …) blend Archetype A
(programming-style imports/references) with a schema-aware twist: the most useful symbols
come from **knowing what the file is** (e.g. `package.json` vs an arbitrary JSON), not from
the syntax alone. Such plugins typically live close to Archetype A in shape but rely on a
file-kind detector + per-schema extractors for high-value graph entities.

## 4. How a new language plugin is added

The process is the same regardless of tier. Each step has tooling that takes care of the
boilerplate.

1. **Scaffold** — `pnpm scaffold lang-<id>` creates `packages/lang-<id>/` with the right
   `package.json`, `tsconfig`, `tsup`, `vitest`, lint baseline, `size-limit`, and an
   extractor + outline skeleton matching the chosen archetype.
2. **(If grammar-based)** Add the grammar entry to
   [`tools/grammar-fetcher/grammars.json`](./tools/grammar-fetcher/grammars.json) (upstream
   release `tag` + `sha256` + `size`) and run `pnpm grammar-fetch` to populate
   `packages/lang-<id>/grammars/`.
3. **Implement the extractor** following the archetype reference plugins. Use shared helpers
   from `@reponova/lang-test-utils` for assertions.
4. **Tests** — produce the standard `simple/`, `medium/`, `complex/` fixtures and the four
   test files (`extractor`, `outline` if applicable, `resolve-imports`, `fixtures`). The
   `complex/` fixture is a pinned snapshot of an OSS project under a permissive license,
   asserted with **invariant-based** checks (counts, top centrality, no >5% orphan ratio,
   parse time under threshold) rather than exact-graph snapshots.
5. **Quality gates** — make `typecheck`, `lint`, `test`, `test:coverage`, `size` green
   locally; CI re-runs them on every push.
6. **Documentation** — the plugin's `README.md` follows the standard plugin README structure
   (intro / install / what it extracts / extensions / configuration / resolution semantics).
7. **Changeset** — `pnpm changeset` describing the new plugin.
8. **First release** — `pnpm bootstrap-plugin lang-<id>` performs the one-time bootstrap
   (publish + Trusted Publisher trust + tag + GitHub Release). Every subsequent release is
   automatic via the version PR + Release workflow.

End-to-end, a fresh Tier 3-ish plugin (effort `S`) tracks roughly half a day from scaffold
to first publish; a Tier 1 language plugin (effort `M`–`L`) lands in 3–10 days depending on
the complexity of import resolution.

## 5. Cross-cutting standards

These are the rules every plugin honours, regardless of tier.

### 5.1 Naming and versioning

- Official plugins: `@reponova/lang-<id>` (lowercase, hyphenated).
- Each plugin tracks **independent SemVer**.
- Each plugin declares `peerDependencies: { "reponova": ">=<core-baseline>" }` with an explicit
  range.
- `engines.node: ">=18"` is the baseline at the time of writing. It is bumped only when a
  required dependency forces it.

### 5.2 Outline support

- Tier 1 (mainstream programming languages): provide both `treeSitterExtract` and
  `regexExtract` so the outline degrades gracefully if WASM fails to load.
- Tier 2/3 (alphabet-of-the-ecosystem, configuration, scripting): outline is optional but
  recommended.
- Tier 4 (diagramming / docs): outline typically does not apply.

### 5.3 Import resolution

`resolveImportPath()` is the most language-specific surface. The general guidelines are:

- Return an array of **candidate** absolute paths. The runtime picks the first that exists.
- For external packages (`node_modules`, system headers, JDK classes, …), return an empty
  array — RepoNova will treat the symbol as external.
- Honour the language's standard module resolution rules (e.g. `tsconfig.json` paths for
  TS/JS, `mod.rs` / `super::` for Rust, `package.foo.Bar` → `package/foo/Bar.java` for Java,
  `#include "x.h"` relative vs `<x.h>` system for C/C++).

### 5.4 Test bench

Mandatory layout:

```
tests/
  fixtures/
    simple/      # ~50 LOC, hand-written
    medium/      # ~500 LOC, multi-file, hand-written
    complex/     # ~3-5k LOC, OSS snapshot pinned by commit SHA + ATTRIBUTION.md + LICENSE
  extractor.test.ts
  outline.test.ts          # if outline supported
  resolve-imports.test.ts
  fixtures.test.ts         # invariant-based checks on the three tiers
```

Assertions on `complex/` are invariant-based (min counts, stable centrality top-N, no >5%
orphans, parse-time budget). Concrete OSS reference projects are chosen at the start of each
new plugin and recorded in `tests/fixtures/complex/<name>/ATTRIBUTION.md`.

### 5.5 Documentation

Every published plugin has a `README.md` covering: what it extracts, supported extensions,
the `reponova.yml` configuration block, and resolution semantics / known design choices.
The structure is mirrored across all plugins; new plugins should be aligned with the
existing READMEs rather than diverge.

## 6. Integration tiers

Tiers prioritise the next plugins by impact and by effort, not by chronology. A wave can be
opportunistic — multiple plugins from different tiers can land in parallel as long as the
quality gates of section 5 hold.

Effort buckets are calibrated against the existing reference plugins (a single developer
familiar with the contract):

- `S` — 1–2 days
- `M` — 3–5 days
- `L` — 1–2 weeks

### 6.1 Tier — Priority pack

A cross-archetype bundle that takes precedence over the thematic tiers below. Selected by
explicit user-facing demand and a pragmatic balance between effort and impact. Unlike the
other tiers, this one groups plugins by **priority**, not by theme — so it intentionally
mixes Archetype A grammar-based extractors with one Archetype B regex plugin. Recommended
implementation order goes lightest → heaviest (`S` → `M` → `L`) to validate the workflow
quickly, then absorb the heavier import-resolution work last. C and C++ stay paired so the
`#include` resolver can be reused.

| Plugin id | Extensions | Strategy | Archetype | Effort | Notes |
|---|---|---|---|---|---|
| `lang-mermaid` | `.mmd`, `.mermaid` (also fenced in Markdown) | regex | B | S | Companion to `lang-plantuml`; flowchart / sequence / class / state / ER / C4 diagram families |
| `lang-sql` | `.sql`, `.ddl`, `.dml`, `.psql`, `.pgsql`, `.tsql` | regex (DDL-focused) | B | M | Tables / views / functions / procedures / triggers / indexes / sequences / types + FK & query refs; multi-dialect (PostgreSQL, MySQL, SQLite, T-SQL, BigQuery). Pivoted to regex because no pre-built `tree-sitter-sql.wasm` is available upstream and the DDL surface RepoNova consumes is well-bounded. |
| `lang-java` | `.java` | `tree-sitter-java` (official) | A | M–L | Complex imports, generics, package → directory mapping |
| `lang-c` | `.c`, `.h` | `tree-sitter-c` (official) | A | M | Header inclusion graph; functions / structs / unions / enums / typedefs / macros + globals; walks `#ifdef` guards and `extern "C"` blocks. All extraction logic lives in workspace-internal `@reponova/lang-c-core` (shared with `lang-cpp`) and is inlined via `tsup --noExternal`. |
| `lang-cpp` | `.cpp`, `.cc`, `.cxx`, `.c++`, `.hpp`, `.hh`, `.hxx`, `.h++` | `tree-sitter-cpp` (official) | A | L | Header/source split, namespaces (incl. anonymous + nested), classes / structs with access modifiers and inheritance, templates (class + free function), ctors / dtors / operator overloads, `using` declarations, alias declarations, out-of-class definitions. Subclasses `CFamilyExtractor` from `@reponova/lang-c-core` and adds C++-specific dispatch on top of the C subset. |

### 6.2 Tier — Enterprise & systems

Mainstream compiled languages with a heavy enterprise footprint and mature tree-sitter
grammars. All Archetype A. Highest impact-per-plugin after the web stack and the priority
pack.

| Plugin id | Extensions | Tree-sitter grammar | Effort | Notes |
|---|---|---|---|---|
| `lang-go` | `.go` | `tree-sitter-go` (official) | M | Clean package system, GOPATH + `go.mod` resolution |
| `lang-csharp` | `.cs` | `tree-sitter-c-sharp` (official) | M–L | Namespaces + partial classes, `using` statements |
| `lang-rust` | `.rs` | `tree-sitter-rust` (official) | M | `mod.rs` + `super::` + `crate::`, traits as edges |

### 6.3 Tier — DevOps & IaC

Configuration- and infra-shaped formats. They are the connective tissue of large monorepos
and benefit a lot from schema-aware extraction (see Archetype "Configuration" in section 3).
All effort `S`–`M`.

| Plugin id | Extensions | Strategy | Effort | Notes |
|---|---|---|---|---|
| `lang-yaml` | `.yml`, `.yaml` | `tree-sitter-yaml` + schema detection | S–M | Kubernetes manifests, GitHub Actions, CI configs |
| `lang-toml` | `.toml` | `tree-sitter-toml` + schema detection | S | `Cargo.toml`, `pyproject.toml` |
| `lang-bash` | `.sh`, `.bash`, `.zsh` | `tree-sitter-bash` | S–M | Function discovery, `source` as imports |
| `lang-dockerfile` | `Dockerfile`, `*.dockerfile` | `tree-sitter-dockerfile` | S | `FROM` / `COPY --from=stage` graph |
| `lang-hcl` | `.tf`, `.hcl` | `tree-sitter-hcl` | M | Terraform module references |

### 6.4 Tier — Ecosystem languages

High-value mainstream languages with solid community grammars. Good candidates for
parallelisable work — once the pattern is well-trodden, individual plugins can be
distributed across contributors.

| Plugin id | Extensions | Tree-sitter grammar | Effort | Notes |
|---|---|---|---|---|
| `lang-php` | `.php` | `tree-sitter-php` (official) | M | WordPress / Laravel install base |
| `lang-ruby` | `.rb` | `tree-sitter-ruby` (official) | M | Rails, DSL-heavy |
| `lang-kotlin` | `.kt`, `.kts` | `tree-sitter-kotlin` (community, mature) | M | Android + JVM backend |
| `lang-swift` | `.swift` | `tree-sitter-swift` (community) | M–L | iOS / macOS, non-trivial syntax |
| `lang-scala` | `.scala`, `.sc` | `tree-sitter-scala` (official) | M | Big data / Spark |
| `lang-dart` | `.dart` | `tree-sitter-dart` (community) | M | Flutter cross-platform |
| `lang-elixir` | `.ex`, `.exs` | `tree-sitter-elixir` (official) | M | Macro-heavy but grammar holds up |

### 6.5 Tier — Data, query, scripting

Specialised but recurring across enterprise codebases. All Archetype A or A-simplified.

| Plugin id | Extensions | Tree-sitter grammar | Effort | Notes |
|---|---|---|---|---|
| `lang-graphql` | `.graphql`, `.gql` | `tree-sitter-graphql` | S | Type definitions, queries |
| `lang-lua` | `.lua` | `tree-sitter-lua` | S–M | Embedded scripting (Neovim, game engines) |

### 6.6 Tier — Documentation & diagrams

Archetype B / C plugins that complement the existing diagram coverage. All effort `S`.

| Plugin id | Extensions | Strategy | Archetype | Notes |
|---|---|---|---|---|
| `lang-asciidoc` | `.adoc`, `.asciidoc` | regex / `tree-sitter-asciidoc` | doc | |
| `lang-org` | `.org` | regex / `tree-sitter-org` | doc | |
| `lang-dbml` | `.dbml` | regex | B | |

## 7. Operating principles

These principles guide the suite over the long run; they apply to every tier.

- **Stability of the contract** — `LanguagePlugin`, `LanguageExtractor`, `FileExtraction`,
  and the edge vocabulary are deliberately stable. Breaking changes are rare and require a
  coordinated `reponova` core release with a coordinated changeset across all official
  plugins.
- **Independence at publish time, integration at dev time** — every plugin is published
  independently, but the monorepo allows cross-plugin refactors in a single PR (e.g.
  `lang-typescript`, `lang-tsx`, and `lang-javascript` all share `lang-typescript-core`
  internally; `lang-c` and `lang-cpp` share `lang-c-core`).
- **Quality gates are non-negotiable** — coverage and bundle-size thresholds are global
  rules, not per-plugin opt-ins. If a plugin needs a higher size budget (e.g. a particularly
  large grammar), the threshold is raised explicitly and reviewed.
- **Privacy first** — no telemetry, no network calls at runtime. Adoption is observed via
  npm download statistics.
- **Install only what you need** — there is no `@reponova/lang-meta` aggregator. Users opt
  into each plugin individually via `reponova lang add`.
- **Reproducible grammars** — bumping a grammar is one textual change to the manifest. The
  `.wasm` blob never enters git history.
- **Idempotent releases** — every step in the release pipeline (publish / tag / GitHub
  Release) is idempotent. Recovering from a partial failure means re-running the workflow,
  not crafting a special path.
