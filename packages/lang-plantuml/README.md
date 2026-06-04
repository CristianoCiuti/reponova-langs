# @reponova/lang-plantuml

PlantUML diagram support for [RepoNova](https://github.com/CristianoCiuti/reponova). Regex-based line-by-line parser — no tree-sitter grammar required.

## Install

```bash
reponova lang add @reponova/lang-plantuml
```

## What it extracts

- **Class diagrams**: `class`, `abstract class` / `abstract`, `interface`, `enum`, plus relationship arrows (`extends`, association, aggregation, composition).
- **Sequence diagrams**: `actor`, `participant`, `boundary`, `control`, `entity`, `collections`.
- **State diagrams**: `state X`, `state "Display" as Alias`. The `[*]` pseudostate is intentionally not a symbol.
- **Component / deployment diagrams**: `component`, `cloud`, `node`, `database`, `queue`, `rectangle`, `frame`, `folder`, `package`, plus the `[Foo]` bracket shorthand for inline components.
- **C4-DSL macros**: `Person`, `Person_Ext`, `System`, `System_Ext`, `SystemDb`, `Container`, `ContainerDb`, `ContainerQueue`, `Component`, `Component_Ext`, plus the `*_Boundary` macros.

Aliases win over display labels: `participant "Web UI" as UI` produces a symbol named `UI` (so arrows like `UI -> API` resolve) with the display label `Web UI` retained as the symbol's docstring. When a node is declared without an alias, the unquoted display label is sanitised into a graph-friendly identifier (`"Public Internet"` → `Public_Internet`).

## Extensions

`.puml`, `.plantuml`

## Configuration

In `reponova.yml`:

```yaml
plugins:
  plantuml:
    enabled: true       # default: true
    parse: true         # default: true — parse PlantUML content to extract symbols
    # patterns: []      # override global patterns for PlantUML files
    # exclude: []       # override global exclude for PlantUML files
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable PlantUML file detection and extraction |
| `parse` | boolean | `true` | Parse PlantUML content to extract symbols and relationships |
| `patterns` | string[] | `[]` | Glob patterns to override global file matching for this plugin |
| `exclude` | string[] | `[]` | Glob patterns to override global exclusions for this plugin |

## Resolution semantics

- Implicit states introduced only by transitions (e.g. `Empty` in `[*] --> Empty`) are **not** promoted to symbols. Add an explicit `state Empty` declaration if you need the node in your graph.
- Relationship arrows are recognised only when both endpoints are bare identifiers. Sequence-message arrows (`Foo -> Bar : msg`) produce `extends` references when both ends are simple identifiers.
- Bracket shorthand (`[Browser]`) records the node but not its containing `cloud { … }` or `node { … }` parent — the symbol hierarchy is intentionally flat.

## License

MIT — see [LICENSE](./LICENSE).
