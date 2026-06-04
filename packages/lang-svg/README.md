# @reponova/lang-svg

SVG diagram support for [RepoNova](https://github.com/CristianoCiuti/reponova).

## Install

```bash
reponova lang add @reponova/lang-svg
```

## What it provides

- **SVG** (`.svg`): Extracts text elements from SVG XML

No tree-sitter grammar required — parsing is regex-based.

## Extensions

`.svg`

## Configuration

In `reponova.yml`:

```yaml
plugins:
  svg:
    enabled: true       # default: true
    parse: true         # default: true — extract text elements from SVG
    # patterns: []      # override global patterns for SVG files
    # exclude: []       # override global exclude for SVG files
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable SVG file detection and extraction |
| `parse` | boolean | `true` | Parse SVG content to extract text elements |
| `patterns` | string[] | `[]` | Glob patterns to override global file matching for this plugin |
| `exclude` | string[] | `[]` | Glob patterns to override global exclusions for this plugin |
