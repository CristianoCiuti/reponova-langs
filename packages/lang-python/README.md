# @reponova/lang-python

Python language support for [RepoNova](https://github.com/CristianoCiuti/reponova).

## Install

```bash
reponova lang add @reponova/lang-python
```

## What it provides

- **Extraction**: Functions, classes, methods, decorators, docstrings, variables, imports, calls, inheritance
- **Outline**: Tree-sitter AST outline with regex fallback
- **Grammar**: `tree-sitter-python.wasm`

## Extensions

`.py`, `.pyw`

## Configuration

In `reponova.yml`:

```yaml
plugins:
  python:
    enabled: true       # default: true
    # patterns: []      # override global patterns for Python files
    # exclude: []       # override global exclude for Python files
```

No custom properties — Python extraction works out of the box with no additional config.
