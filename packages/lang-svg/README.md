# @reponova/lang-svg

SVG asset support for [RepoNova](https://github.com/CristianoCiuti/reponova). Regex-based parser — no tree-sitter grammar required.

## Install

```bash
reponova lang add @reponova/lang-svg
```

## What it extracts

- **File docstring**: the first `<title>` element (typically the diagram title).
- **Symbols**: up to 20 unique meaningful labels found in `<text>` elements (sanitised into graph-friendly names). Each symbol carries the original label as its docstring.
- **File node kind**: `diagram` with the `svg` tag.

Useful for tracking design assets, hand-authored diagrams (Inkscape, Excalidraw), icon libraries, and rendered Mermaid / PlantUML output.

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

## Resolution semantics

- Symbols are derived from `<text>` element content. Numeric-only labels (e.g. axis ticks) and labels shorter than 3 / longer than 80 characters are filtered out.
- Names are sanitised: non-`[a-zA-Z0-9_\s-]` characters are stripped, runs of whitespace collapse to `_`, the result is truncated to 60 characters. Original labels are preserved verbatim in `docstring`.
- The plugin imposes a 20-symbol-per-file cap to keep large iconographic SVGs from dominating the graph.

## License

MIT — see [LICENSE](./LICENSE).
