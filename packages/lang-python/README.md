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

## Test fixtures

The package ships three tiers of test fixtures, in line with section 8.7 of the workspace integration plan:

- **`tests/fixtures/simple/cli.py`** — a small typed CLI module exercising functions, a `Greeter` class with `__init__`, a couple of constants and stdlib imports.
- **`tests/fixtures/medium/cache.py`** — a richer module that exercises `dataclass`, abstract base classes, generics (`TypeVar`), a custom decorator, async methods, and `__all__` exports.
- **`tests/fixtures/complex/click-8.4.1/`** — a 17-file, ~393 KB verbatim snapshot of [`pallets/click`](https://github.com/pallets/click) `src/click/`, pinned at `8.4.1`, BSD-3-Clause-licensed. Provenance and per-file SHA-256 hashes are recorded in [`ATTRIBUTION.md`](./tests/fixtures/complex/click-8.4.1/ATTRIBUTION.md). The complex tier guards against regressions on real-world Python with deep class hierarchies (`BaseCommand` → `Command` → `Group`), heavy decorator usage, and a wide exception subtype tree.

### Known limitation surfaced by the fixtures

The current extractor records class bases only for AST node types
`identifier`, `dotted_name`, and `attribute`. Subscripted generic bases
like `Cache[K, V]` or `Generic[K, V]` are skipped today; this is pinned
by an explicit `it("known limitation: …")` test under the `medium/`
fixture so a future enhancement can flip the expectation.
