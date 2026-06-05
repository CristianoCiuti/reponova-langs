# @reponova/lang-python

## 0.3.0

### Minor Changes

- 02e14cd: feat(lang-python): unwrap subscripted generic bases (`Cache[K, V]`) to their bare type names

  The class heritage extractor used to skip `subscript` AST nodes, so
  `class InMemoryCache(Cache[K, V])` produced `bases: []` and no
  `extends` reference. It now recursively unwraps `subscript` nodes via
  their `value` field, so:

  - `class Cache(ABC, Generic[K, V])` → `bases: ["ABC", "Generic"]`
  - `class InMemoryCache(Cache[K, V])` → `bases: ["Cache"]`
  - `class StrBox(typing.Generic[K])` → `bases: ["typing.Generic"]`
  - Nested generics (`Mapping[K, list[V]]`) collapse to the outermost name (`Mapping`).

  Keyword arguments such as `metaclass=Meta` continue to be ignored.

  Each captured base also emits an `extends` reference from the subclass
  to the base name (previously omitted for subscripted bases).

  The previous "known limitation" pin in
  `tests/fixtures.test.ts > medium/cache.py` has been replaced with a
  positive regression test, and a focused unit test was added in
  `tests/extractor.test.ts`.

- 1526c38: feat(lang-python): conditional-block imports, TypeVar / NewType / type aliases, async marker, outline parity

  Substantially expands what the Python extractor surfaces, with full parity between the graph extractor and the outline pipeline:

  - **Conditional-block imports**: `from x import y` and declarations nested inside `if TYPE_CHECKING:` blocks, `try / except ImportError:` soft-dependency blocks, `else_clause` / `elif_clause` / `finally_clause` are now surfaced at the module level. The previous release only walked direct children of the module node, dropping every typed Python project's `TYPE_CHECKING` imports on the floor.
  - **`from __future__ import …` directives**: tree-sitter-python parses these as `future_import_statement`, which the extractor now handles explicitly under the synthetic module name `__future__`.
  - **Typing constructors as `type` symbols**: `K = TypeVar("K")`, `UserId = NewType("UserId", int)`, `P = ParamSpec("P")`, and `Ts = TypeVarTuple("Ts")` are captured with `kind: "type"` and a constructor-tagged `decorators` entry (`typevar`, `newtype`, `paramspec`, `typevartuple`). Qualified calls (`typing.TypeVar`, `t.TypeVar`) are recognised too.
  - **Type aliases**: PascalCase assignments whose RHS is a `subscript` (`User = Dict[str, Any]`, `Ids = list[int]`), a typing union (`Maybe = Union[int, None]`), or a PEP 604 union (`Either = int | str`) are captured as `kind: "type"` with `decorators: ["alias"]`. The heuristic is conservative: lowercase names like `result = mapping[key]` are intentionally NOT promoted, and `UPPER_SNAKE_CASE` names continue to map to `kind: "constant"`.
  - **PEP 695 `type Foo = …`**: the new `type_alias_statement` AST node from Python 3.12+ is handled, emitting `kind: "type"` with `decorators: ["pep695"]`.
  - **Async marker**: `async def fetch(...)` and `async def Worker.run(...)` now carry `"async"` in their `decorators` array. Sync functions are unchanged.
  - **Outline parity**: the tree-sitter outline pipeline (`outline.ts`) now uses the same container walker for nested blocks and the same `unwrapBase` helper for class heritage as the extractor, so the IDE outline view matches the graph view on `if TYPE_CHECKING:` imports and subscripted bases like `class StrCache(Cache[str, str])`.

  Eight new unit tests and one new fixture-level test pin every behaviour above; the existing 18 unit tests and the click 8.4.1 complex fixture continue to pass unchanged.

### Patch Changes

- 0fc86ae: Add `simple/` + `medium/` + `complex/` test fixture tiers, in line with section 8.7 of the integration plan, bringing the three Wave-0 plugins to the same coverage shape as `@reponova/lang-typescript`. No runtime behaviour change.

  - `lang-python`: hand-authored `simple/cli.py` and `medium/cache.py`, plus a 17-file verbatim snapshot of `pallets/click` 8.4.1 (BSD-3-Clause) under `complex/click-8.4.1/`. SHA-256 hashes pinned in `_manifest.json` and `ATTRIBUTION.md`.
  - `lang-plantuml`: hand-authored `simple/`, `medium/` and 5 `complex/` diagrams (class, sequence, component, state, C4 context). The fixtures intentionally cover diagram families the regex extractor does not yet handle, so a future extractor extension already has its regression surface ready.
  - `lang-svg`: hand-authored `simple/layout.svg` and `medium/dashboard.svg`, plus a 75-icon snapshot of `simple-icons/simple-icons` 16.22.0 (CC0).

  The fixture directories are excluded from the published npm tarballs (the `files` whitelist already covers `dist`/`grammars`/`README.md`/`LICENSE` only) and from ESLint (`tests/fixtures/complex/**` is now ignored at the workspace level so vendored sources are never autofixed).

- 75b2b38: chore(langs): npm-friendly READMEs and discovery keywords

  Reshape the four `@reponova/lang-*` README files for npm consumers:

  - Drop the `Test fixtures` / `Known limitation` / `Tree-sitter grammar` / `Class heritage extraction` sections — those are repo-internal concerns that are already covered by the source tree, the package's own tests, and the contributing guide. They have no value on the npm registry.
  - Standardise every plugin around the same five sections: `Install`, `What it extracts`, `Extensions`, `Configuration` (with a uniform property table), `Resolution semantics`, `License`.
  - Promote `lang-typescript` and `lang-python` to the same `enabled / patterns / exclude` configuration table style already used by `lang-plantuml` and `lang-svg`, so configuration documentation is homogeneous across the four published plugins.

  Add `keywords` to every plugin's `package.json` so npm search surfaces them under their language, file extension, and feature aliases (`tree-sitter`, `static-analysis`, `knowledge-graph`, `class-diagram`, `c4-diagram`, `vector-graphics`, …).

  Slim the workspace root README down to consumer / discovery content: package matrix, install snippet, architecture, link to `CONTRIBUTING.md`. Move the developer-facing material (local setup, grammar workflow, npm OIDC trust publisher, scaffold, release procedure, repository layout) to a new `CONTRIBUTING.md` so contributors still have one canonical place to look.

  No source-code or behavioural changes.

## 0.2.1

### Patch Changes

- 59d8dfd: Source the bundled tree-sitter grammar from the upstream
  [`tree-sitter/tree-sitter-python@v0.25.0`](https://github.com/tree-sitter/tree-sitter-python/releases/tag/v0.25.0)
  release at build time instead of carrying the `.wasm` binary in git.

  Functionally a no-op for consumers: the published npm tarball still ships
  `grammars/tree-sitter-python.wasm` and the file bytes are identical
  (sha256 `16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47`).

  Internal change: the new `@reponova/grammar-fetcher` build tool downloads
  and SHA-256-verifies the grammar from its pinned upstream release before
  `tsup` runs.

## 0.2.0

### Minor Changes

- bab08eb: Migrate to the unified `reponova-langs` monorepo.

  No behavioural changes to the extractors. Internals:

  - `peerDependencies.reponova` tightened from `^0.x` to `^0.4.0`
  - `engines.node` declared as `>=18` in every package
  - Build/test/typecheck configs now extend shared monorepo bases
  - Released from a single repository with coordinated CI on Ubuntu / Windows / macOS x Node 18 / 20 / 22
