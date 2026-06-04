# @reponova/lang-python

Python language support for [RepoNova](https://github.com/CristianoCiuti/reponova). Parses `.py` / `.pyw` source files via the official [`tree-sitter-python`](https://github.com/tree-sitter/tree-sitter-python) WASM grammar.

## Install

```bash
reponova lang add @reponova/lang-python
```

## What it extracts

- **Symbols**:
  - Functions and async functions (the latter carry an `async` decorator marker).
  - Classes and methods, including those declared inside `if TYPE_CHECKING:` / `try / except` blocks.
  - Top-level `UPPER_SNAKE_CASE` constants.
  - `TypeVar` / `NewType` / `ParamSpec` / `TypeVarTuple` declarations as `type` symbols.
  - PascalCase type aliases (`User = Dict[str, Any]`, `Maybe = int | None`) and PEP 695 `type Foo = …` aliases.
- **Decorators**: `@decorator` / `@module.decorator` on functions, methods, and classes.
- **Docstrings**: module-level (first triple-quoted expression), per-function and per-class.
- **Imports**: `import x`, `from x import y`, `from . import y`, `from .. import y`, aliased imports (`import x as y`), wildcard imports (`from x import *`), `from __future__ import …` directives. Imports nested inside `if TYPE_CHECKING:` and `try / except ImportError:` blocks are surfaced at the module level. `__init__.py` imports are flagged as exports.
- **Heritage**: plain (`Foo(Bar)`), subscripted generics (`Foo(Bar[K, V])` → `Bar`), dotted (`Foo(pkg.mod.Bar)`). `metaclass=Meta` keyword arguments are ignored.
- **Calls**: every call expression in a function/method body, by name.
- **Exports**: `__all__` literal list when present; otherwise every public top-level symbol (no leading `_`).

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

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable Python file detection and extraction |
| `patterns` | string[] | `[]` | Glob patterns to override global file matching for this plugin |
| `exclude` | string[] | `[]` | Glob patterns to override global exclusions for this plugin |

## Resolution semantics

- `from .module import x` resolves relative to the importer file. `from ..pkg import y` walks two directories up.
- Bare absolute imports (`from foo.bar import baz`) return both `foo/bar.py` and `foo/bar/__init__.py` as candidates; existence is checked by the host application.
- Each captured class base also emits an `extends` reference. Calls produce `calls` references on the enclosing function/method.

## License

MIT — see [LICENSE](./LICENSE).
