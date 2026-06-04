---
"@reponova/lang-python": minor
---

feat(lang-python): conditional-block imports, TypeVar / NewType / type aliases, async marker, outline parity

Substantially expands what the Python extractor surfaces, with full parity between the graph extractor and the outline pipeline:

- **Conditional-block imports**: `from x import y` and declarations nested inside `if TYPE_CHECKING:` blocks, `try / except ImportError:` soft-dependency blocks, `else_clause` / `elif_clause` / `finally_clause` are now surfaced at the module level. The previous release only walked direct children of the module node, dropping every typed Python project's `TYPE_CHECKING` imports on the floor.
- **`from __future__ import …` directives**: tree-sitter-python parses these as `future_import_statement`, which the extractor now handles explicitly under the synthetic module name `__future__`.
- **Typing constructors as `type` symbols**: `K = TypeVar("K")`, `UserId = NewType("UserId", int)`, `P = ParamSpec("P")`, and `Ts = TypeVarTuple("Ts")` are captured with `kind: "type"` and a constructor-tagged `decorators` entry (`typevar`, `newtype`, `paramspec`, `typevartuple`). Qualified calls (`typing.TypeVar`, `t.TypeVar`) are recognised too.
- **Type aliases**: PascalCase assignments whose RHS is a `subscript` (`User = Dict[str, Any]`, `Ids = list[int]`), a typing union (`Maybe = Union[int, None]`), or a PEP 604 union (`Either = int | str`) are captured as `kind: "type"` with `decorators: ["alias"]`. The heuristic is conservative: lowercase names like `result = mapping[key]` are intentionally NOT promoted, and `UPPER_SNAKE_CASE` names continue to map to `kind: "constant"`.
- **PEP 695 `type Foo = …`**: the new `type_alias_statement` AST node from Python 3.12+ is handled, emitting `kind: "type"` with `decorators: ["pep695"]`.
- **Async marker**: `async def fetch(...)` and `async def Worker.run(...)` now carry `"async"` in their `decorators` array. Sync functions are unchanged.
- **Outline parity**: the tree-sitter outline pipeline (`outline.ts`) now uses the same container walker for nested blocks and the same `unwrapBase` helper for class heritage as the extractor, so the IDE outline view matches the graph view on `if TYPE_CHECKING:` imports and subscripted bases like `class StrCache(Cache[str, str])`.

Eight new unit tests and one new fixture-level test pin every behaviour above; the existing 18 unit tests and the click 8.4.1 complex fixture continue to pass unchanged.
