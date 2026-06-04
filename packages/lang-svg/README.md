# @reponova/lang-svg

SVG asset support for [RepoNova](https://github.com/CristianoCiuti/reponova). Regex-based parser — no tree-sitter grammar required.

## Install

```bash
reponova lang add @reponova/lang-svg
```

## What it extracts

- **File docstring**: the first `<title>` element (typically the diagram title), with multi-line bodies and XML entities normalised to a single line.
- **Symbols**: up to 20 unique meaningful labels per file, surfaced from any of:
  - `<text>` element bodies (multi-line and `<tspan>` children are joined into a single label)
  - `<title>` element bodies
  - `<desc>` long-form description elements
  - `aria-label="…"` attributes on any element (essential for path-only icon SVGs)
  Each symbol's `decorators[0]` records the source (`svg_text` / `svg_title` / `svg_desc` / `svg_aria_label`) and the original label is preserved verbatim in `docstring`.
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

- Numeric-only labels (`123`, `12.5`), labels shorter than 3 characters, and labels longer than 200 characters are filtered out.
- Inner XML markup inside extracted bodies is stripped before normalisation, so `<text><tspan>Auth</tspan><tspan>Service</tspan></text>` becomes `Auth Service`. Common XML entities (`&amp;`, `&lt;`, `&#39;`, hex escapes) are decoded.
- Names are sanitised for graph use: non-`[a-zA-Z0-9_\s-]` characters are stripped, whitespace collapses to `_`, and the result is truncated to 60 characters. Original labels are preserved verbatim in `docstring`.
- The plugin imposes a 20-symbol-per-file cap (across all sources combined) to keep large iconographic SVGs from dominating the graph.

## License

MIT — see [LICENSE](./LICENSE).
