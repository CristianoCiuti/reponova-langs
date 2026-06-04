# @reponova/lang-plantuml

PlantUML diagram support for [RepoNova](https://github.com/CristianoCiuti/reponova).

## Install

```bash
reponova lang add @reponova/lang-plantuml
```

## What it provides

- **PlantUML** (`.puml`, `.plantuml`): regex-based line-by-line parser (no tree-sitter grammar required) covering:
  - **Class diagrams**: `class`, `abstract class` / `abstract`, `interface`, `enum`, plus relationship arrows.
  - **Sequence diagrams**: `actor`, `participant`, `boundary`, `control`, `entity`, `collections`.
  - **State diagrams**: `state X`, `state "Display" as Alias`. The `[*]` pseudostate is intentionally not a symbol.
  - **Component / deployment diagrams**: `component`, `cloud`, `node`, `database`, `queue`, `rectangle`, `frame`, `folder`, `package`, plus the `[Foo]` bracket shorthand for inline components.
  - **C4-DSL macros**: `Person`, `Person_Ext`, `System`, `System_Ext`, `SystemDb`, `Container`, `ContainerDb`, `ContainerQueue`, `Component`, `Component_Ext`, plus the `*_Boundary` macros.

Aliases win over display labels: `participant "Web UI" as UI` produces a symbol named `UI` (so it joins arrows like `UI -> API`) with the display label `Web UI` retained as the symbol's docstring. When a node is declared without an alias, the unquoted display label is sanitised into a graph-friendly identifier (`"Public Internet"` → `Public_Internet`).

## Extensions

`.puml`, `.plantuml`

## Configuration

In `reponova.yml`:

```yaml
plugins:
  plantuml:
    enabled: true       # default: true
    parse: true         # default: true — parse PlantUML component relationships
    # patterns: []      # override global patterns for PlantUML files
    # exclude: []       # override global exclude for PlantUML files
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable PlantUML file detection and extraction |
| `parse` | boolean | `true` | Parse PlantUML content to extract classes, interfaces, and relationships |
| `patterns` | string[] | `[]` | Glob patterns to override global file matching for this plugin |
| `exclude` | string[] | `[]` | Glob patterns to override global exclusions for this plugin |

## Test fixtures

The package ships three tiers of test fixtures, in line with section 8.7 of the workspace integration plan:

- **`tests/fixtures/simple/auth-classes.puml`** — a 4-class diagram with one abstract type and one note.
- **`tests/fixtures/medium/order-flow.puml`** — a multi-actor sequence diagram with `alt` branches, activations and notes.
- **`tests/fixtures/complex/`** — five hand-authored real-world diagrams (class, sequence, component, state, C4 context). Hand-authored rather than vendored from upstream because most public PlantUML libraries (e.g. plantuml-stdlib) ship under GPL/CC-BY-SA terms that are not compatible with re-distribution as MIT-licensed test fixtures.

### Known limits today

- Implicit states introduced only by transitions (e.g. `Empty` in `[*] --> Empty`) are **not** promoted to symbols. Only explicit `state X` / `state "Display" as Alias` declarations count. Add the explicit declaration if you need the node in your graph.
- Relationship arrows are recognised only for class-style diagrams (`Foo --> Bar`), where both endpoints are bare identifiers. Sequence-message arrows (`Foo -> Bar : msg`) are matched by the same regex so they also produce `extends` references when both ends are simple identifiers.
- Bracket shorthand (`[Browser]`) records the node but not its containing `cloud { … }` or `node { … }` parent — the hierarchy is flat.
