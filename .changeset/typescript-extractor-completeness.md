---
"@reponova/lang-typescript": minor
---

feat(lang-typescript): class fields, accessors, async / generator markers, exported const, overload dedup, .d.ts ambient declarations

Closes the documented coverage gaps in the TypeScript extractor:

- **Class fields** (`public_field_definition`): `class HttpClient { private readonly baseUrl: string; static defaultTimeoutMs = 30_000; }` now surfaces `baseUrl` and `defaultTimeoutMs` as `variable` symbols hung under their class. Accessibility (`public` / `private` / `protected`), `readonly`, and `static` are preserved in `decorators`. Previously fields were silently dropped — only methods were captured.
- **Getters and setters**: `class Counter { get value() {…}; set value(v) {…} }` now produces two separate symbols, both with the clean `qualifiedName` `mod.Counter.value` and tagged `decorators: ["getter"]` / `["setter"]` respectively.
- **Async / generator markers**: `async function`, `async () => …`, `async method()`, and `function* gen()` carry `"async"` and/or `"generator"` as the first entries of their `decorators` array.
- **Abstract methods**: `abstract bar(): void` now produces a method symbol decorated with `"abstract"`.
- **Exported `const` of any case**: `export const userService = createUserService()` now produces a `constant` symbol. The previous release only kept `UPPER_SNAKE_CASE` bindings, silently dropping the canonical TypeScript DI / module-singleton pattern. Internal lowercase non-arrow `const` bindings remain hidden.
- **`function_signature` / `method_signature` / `abstract_method_signature`**: tree-sitter-typescript represents `.d.ts` ambient declarations and overload signatures with these node types. They are now extracted, so `.d.ts` files produce graph symbols for the first time.
- **Overload dedup**: a sequence of `function format(x: number): string;` / `function format(x: string): string;` / `function format(x: number | string): string { … }` collapses to exactly one symbol per name (the implementation). Same logic applies to method overloads inside classes. Getters and setters with the same name are NOT deduped against each other.

Five new unit tests pin: class fields with modifiers, getter/setter pairs, async / generator markers, exported const promotion, overload dedup. The 22 existing unit tests, the 5 zod v3.24.1 complex-fixture tests, and the resolve-imports tests all continue to pass unchanged.
