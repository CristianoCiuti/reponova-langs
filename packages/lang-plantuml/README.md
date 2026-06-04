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
