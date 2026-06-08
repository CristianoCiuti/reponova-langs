# @reponova/lang-plantuml

## 0.4.0

### Minor Changes

- e6c20e7: Align official plugins with reponova v0.5 manifest spec.

  - `package.json.keywords` switches to the single canonical token
    `reponova-language` (the legacy `reponova-plugin` / `language-plugin`
    keywords are removed). This is the only keyword now consulted by
    `reponova lang suggest` on the npm registry.
  - `package.json.reponova.extensions[]` is now the single source of truth
    for file extensions. The previously-duplicated `extensions` field on the
    exported `LanguagePlugin` object has been removed — the loader reads
    extensions from the manifest exclusively.
  - `peerDependencies.reponova` bumped to `^0.5.0` (the host release that
    introduced the new manifest validation).

## 0.3.0

### Minor Changes

- f9d72fc: feat(lang-plantuml): support sequence, state, component, and C4-DSL diagrams

  The extractor previously recognised only class-diagram constructs
  (`class`, `interface`, `enum`, `abstract` / `abstract class`). Sequence,
  state, component, and C4 diagrams parsed without crashing but emitted
  zero symbols, leaving downstream graphs blank for those files.

  This change extends the regex-based extractor to cover:

  - **Sequence diagrams**: `actor`, `participant`, `boundary`, `control`, `entity`, `collections`.
  - **State diagrams**: `state X`, `state "Display" as Alias`. The `[*]` pseudostate is intentionally never a symbol; states introduced only by transitions (e.g. `Empty` in `[*] --> Empty`) are also not promoted — declare them explicitly if you need them.
  - **Component / deployment diagrams**: `component`, `cloud`, `node`, `database`, `queue`, `rectangle`, `frame`, `folder`, `package`, plus the `[Foo]` bracket shorthand for inline components.
  - **C4-DSL macros**: `Person`, `Person_Ext`, `System`, `System_Ext`, `SystemDb`, `Container`, `ContainerDb`, `ContainerQueue`, `Component`, `Component_Ext`, and the `*_Boundary` family.

  ### Behavioural change worth flagging

  Aliases now win over display labels for the canonical symbol name:
  `participant "Web UI" as UI` produces a symbol named `UI` (matching
  the way arrows like `UI -> API` reference it) and retains `Web UI` as
  the symbol's docstring. Previously, quoted class declarations such as
  `class "MyClass" as MC` were stored under `MyClass`, which left the
  `MC --> X` arrow with a dangling reference. The corresponding inline
  test (`should handle quoted names`) has been replaced with one that
  asserts the alias-wins behaviour.

  Container nodes declared without an alias (`cloud "Public Internet"
{ … }`) are sanitised into a graph-friendly identifier (spaces become
  underscores, non-alphanumerics are stripped): `Public_Internet`.

  Duplicate declarations (e.g. an explicit `component "Browser" as
Browser` plus a later `[Browser]` shorthand) are de-duplicated to a
  single symbol.

  The complex/ fixture tests now assert positive expectations on
  `auth-sequence.puml`, `order-state.puml`, `service-components.puml`,
  and `system-context.puml` instead of pinning the old "zero symbols"
  behaviour.

- a5e912e: feat(lang-plantuml): implicit-state promotion + caption / header / footer metadata fallback

  Closes the two remaining documented gaps in the PlantUML extractor:

  - **Implicit-state promotion**: any bare identifier that appears as a transition endpoint and never receives an explicit declaration anywhere else in the file is now promoted to a `component` symbol decorated with `["state", "implicit"]`. A pure-transition state diagram such as

    ```plantuml
    [*] --> Draft
    Draft --> Submitted
    Submitted --> Approved
    ```

    used to produce zero symbols (you had to add standalone `state X` lines for each); it now produces three implicit-state symbols (`Draft`, `Submitted`, `Approved`).

    Promotion runs in a second pass AFTER the main loop, so a node that's declared explicitly later in the file (`state Submitted #green`) wins over an earlier transition mention and keeps the regular `["state"]` decorator without the `implicit` marker.

  - **Metadata fallback for the file docstring**: the file-node docstring used to look at `title` only. It now falls back through the precedence chain `title` > `caption` > `header` > `footer`, so PlantUML files annotated with `caption`, `(center) header`, or `footer` produce a useful docstring instead of `undefined`. Both inline forms (`title Foo`) and multi-line block forms (`header\n  Foo\nendheader` / `footer\n…\nendfooter`) are recognised. The body of multi-line `header` / `footer` blocks is intentionally NOT parsed as PlantUML, so misleading content inside an annotation block (`Foo --> Bar` inside `header`) does NOT create spurious symbols or transitions.

  Five new unit tests pin the new behaviour. The existing fixture-level test for `complex/order-state.puml` is updated to assert that `Empty`, `Cancelled`, `Delivered`, and `Closed` are now surfaced as implicit-state symbols.

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

## 0.2.0

### Minor Changes

- bab08eb: Migrate to the unified `reponova-langs` monorepo.

  No behavioural changes to the extractors. Internals:

  - `peerDependencies.reponova` tightened from `^0.x` to `^0.4.0`
  - `engines.node` declared as `>=18` in every package
  - Build/test/typecheck configs now extend shared monorepo bases
  - Released from a single repository with coordinated CI on Ubuntu / Windows / macOS x Node 18 / 20 / 22
