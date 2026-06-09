# @reponova/lang-mermaid

[Mermaid](https://mermaid.js.org/) diagram support for [RepoNova](https://github.com/CristianoCiuti/reponova). Regex-based line-by-line parser — no tree-sitter grammar required.

## Install

```bash
reponova lang add @reponova/lang-mermaid
```

## What it extracts

The extractor recognises the diagram family from the first non-blank, non-comment line and dispatches to a per-family handler. Across families it emits one of:

- **File node**: always `kind: "diagram"`, tagged `["mermaid", "<family>"]`. The file docstring is the YAML-frontmatter `title:` if present, otherwise the inline `title` directive.
- **Symbols**: per-family entities (nodes, participants, classes, states, …) with the originating Mermaid keyword preserved as the first `decorator` so consumers can filter by family.
- **References**: edges between symbols, projected onto the `extends` / `references` edge types from the RepoNova edge vocabulary.

### Supported diagram families

| Family | Header | Symbols | Edges |
|---|---|---|---|
| Flowchart / graph | `flowchart …`, `graph …` | every node id (with the shape captured as a secondary decorator: `circle`, `diamond`, `cylinder`, `hexagon`, `stadium`, `subroutine`, `trapezoid`, …); `subgraph` blocks become `module`-kind containers, nested nodes carry `parent` | every arrow as a `references` edge, plus edge endpoints promoted to default-rectangle nodes when no explicit declaration exists |
| Sequence | `sequenceDiagram` | `actor` / `participant` declarations by alias (display label kept as docstring); implicit participants promoted from arrows (decorator `["participant", "implicit"]`) | messages as `references` |
| Class / class-v2 | `classDiagram`, `classDiagram-v2` | classes, `<<interface>>` / `<<abstract>>` / `<<enumeration>>` stereotypes (interfaces become `kind: "interface"`); inside-block members split into `method` (with paren signature) and `variable` (field) with visibility decorators `public`/`private`/`protected`/`package` | `<\|--`, `<\|..` produce `extends` (with direction normalised so the child points at the parent); other arrows become `references` |
| State / state-v2 | `stateDiagram`, `stateDiagram-v2` | explicit `state X` and `state "Display" as X` declarations; `<<choice>>` / `<<fork>>` / `<<join>>` stereotypes; transition endpoints promoted to implicit states (decorator `["state", "implicit"]`); the `[*]` pseudostate is intentionally NOT a symbol | transitions as `references` |
| ER | `erDiagram` | entities as `class`-kind symbols; attributes inside `{ … }` blocks as `variable` children carrying the type as docstring and `PK` / `FK` / `UK` constraints as secondary decorators | relations as `references`, with the relation label attached to the source entity as a docstring fallback |
| Gantt | `gantt` | `section` declarations as `section`-kind symbols; tasks as children of the most recent section | (none — Gantt has no cross-references) |
| Journey | `journey` | sections + tasks (with actor lists kept inside the task docstring) | (none) |
| GitGraph | `gitGraph` | commits (id or auto-generated `c<n>`) as children of the current branch; branches as `module`-kind symbols | `merge` lines as `references` between branches |
| Pie | `pie` | each `"slice" : value` as a `pie_slice` symbol with `name = value` in the docstring | (none) |
| Mindmap | `mindmap` | hierarchical via indentation; node identifier preserved, shape stored as secondary decorator (`circle`, `rounded`, `rectangle`, `hexagon`, `subroutine`, `bang`) | (none — parent is the structural edge) |
| Timeline | `timeline` | sections + periods + events with parent relationships | (none) |
| C4 | `C4Context`, `C4Container`, `C4Component`, `C4Deployment`, `C4Dynamic` | `Person`, `System`, `Container`, `Component`, `Boundary`, `Deployment_Node`, … macros (each keyword preserved as `c4_<macro>` decorator) | `Rel`, `BiRel`, `Rel_U/D/L/R`, `Rel_Back`, `Rel_Neighbor` as `references` |
| Requirement | `requirementDiagram` | `requirement` / `functionalRequirement` / `interfaceRequirement` / … as `interface`-kind symbols; `element` as `component`-kind | relations (`contains`, `derives`, `satisfies`, `verifies`, `refines`, `traces`, `copies`) as `references` |
| Zenuml | `zenuml` | `@Actor`, `@Database`, `@Boundary`, `@Control`, `@Entity`, `@Queue`, `@EC2`, `@S3`, `@RDS`, `@LB`, `@Internet`, `@Lambda` annotators | `A -> B` arrows as `references` |
| (unknown) | anything else | none — still produces a valid `fileNode` tagged `["mermaid", "unknown"]` | (none) |

## Extensions

`.mmd`, `.mermaid`

## Configuration

In `reponova.yml`:

```yaml
plugins:
  mermaid:
    enabled: true       # default: true
    parse: true         # default: true — parse Mermaid content to extract symbols
    # patterns: []      # override global patterns for Mermaid files
    # exclude: []       # override global exclude for Mermaid files
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable Mermaid file detection and extraction |
| `parse` | boolean | `true` | Parse Mermaid content to extract symbols and relationships |
| `patterns` | string[] | `[]` | Glob patterns to override global file matching for this plugin |
| `exclude` | string[] | `[]` | Glob patterns to override global exclusions for this plugin |

## Resolution semantics

- **No imports**: Mermaid files do not reference each other; `resolveImportPath` is a hard no-op that always returns `[]`.
- **Frontmatter handling**: a YAML `---` block at the very top of the file is stripped before parsing. If it contains a `title:` key, the value becomes the file's docstring (taking precedence over any inline `title` directive). All other frontmatter keys are ignored.
- **`%%{init: …}%%` directives**: the initial config directive is stripped wholesale (including multi-line forms) before family detection — its body is JSON-shaped configuration, not Mermaid syntax.
- **`%% comments`**: standalone comment lines are skipped per family. End-of-line comments inside other syntactic constructs are not stripped — they are typically tolerated by the per-family regexes.
- **Edge direction**: in class diagrams, arrows whose head is on the left (`<--`, `<..`, `<|--`, `<|..`) have their source and target swapped so the resulting edge always points "child → parent" in graph terms. This matches the way RepoNova's `extends` edges are interpreted.
- **Identifier collisions**: a symbol is added only once per `(parent, name)` key. The first declaration wins; later mentions on relationship lines do not duplicate it.

## License

MIT — see [LICENSE](./LICENSE).
