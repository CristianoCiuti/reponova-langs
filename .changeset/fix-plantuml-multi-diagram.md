---
"@reponova/lang-plantuml": minor
---

feat(lang-plantuml): support sequence, state, component, and C4-DSL diagrams

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
