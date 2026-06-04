---
"@reponova/lang-python": minor
---

feat(lang-python): unwrap subscripted generic bases (`Cache[K, V]`) to their bare type names

The class heritage extractor used to skip `subscript` AST nodes, so
`class InMemoryCache(Cache[K, V])` produced `bases: []` and no
`extends` reference. It now recursively unwraps `subscript` nodes via
their `value` field, so:

- `class Cache(ABC, Generic[K, V])` → `bases: ["ABC", "Generic"]`
- `class InMemoryCache(Cache[K, V])` → `bases: ["Cache"]`
- `class StrBox(typing.Generic[K])` → `bases: ["typing.Generic"]`
- Nested generics (`Mapping[K, list[V]]`) collapse to the outermost name (`Mapping`).

Keyword arguments such as `metaclass=Meta` continue to be ignored.

Each captured base also emits an `extends` reference from the subclass
to the base name (previously omitted for subscripted bases).

The previous "known limitation" pin in
`tests/fixtures.test.ts > medium/cache.py` has been replaced with a
positive regression test, and a focused unit test was added in
`tests/extractor.test.ts`.
