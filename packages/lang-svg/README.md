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

## Test fixtures

The package ships three tiers of test fixtures, in line with section 8.7 of the workspace integration plan:

- **`tests/fixtures/simple/layout.svg`** — a 3-tier layout SVG with three labelled boxes.
- **`tests/fixtures/medium/dashboard.svg`** — a richer "Operations Dashboard" mock with gradients, filters, patterns, and ~10 distinct text labels.
- **`tests/fixtures/complex/simple-icons-16.22.0/`** — a 75-icon, ~97 KB curated subset of [`simple-icons/simple-icons`](https://github.com/simple-icons/simple-icons), pinned at `16.22.0`, CC0-1.0 (public domain). Provenance and per-file SHA-256 hashes are recorded in [`ATTRIBUTION.md`](./tests/fixtures/complex/simple-icons-16.22.0/ATTRIBUTION.md). Most icons are pure path glyphs without `<text>` elements; the complex tier exists primarily to confirm that the extractor handles every glyph without throwing.
