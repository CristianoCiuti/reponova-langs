# @reponova/lang-plantuml

PlantUML diagram support for [RepoNova](https://github.com/CristianoCiuti/reponova).

## Install

```bash
reponova lang add @reponova/lang-plantuml
```

## What it provides

- **PlantUML** (`.puml`, `.plantuml`): Extracts classes, interfaces, relationships from PlantUML diagrams

No tree-sitter grammar required — parsing is regex-based.

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

### Known extractor scope (today)

The current extractor recognises class-diagram constructs (`class`,
`interface`, `enum`, `abstract`/`abstract class`) plus the `title`
directive. It does **not** yet recognise:

- sequence-diagram `actor` / `participant ... as ...`
- state-diagram `state ...` / `[*]` transitions
- component-diagram `component`/`cloud`/`node`/`database`/`queue`/`rectangle` keywords
- C4-style `Person` / `System` / `Container` macros

The complex/ fixtures intentionally cover those diagram families so that,
when the extractor is later extended, the regression surface is already
in place. The current behaviour is pinned by explicit tests under
`tests/fixtures.test.ts > complex/ tier`.
