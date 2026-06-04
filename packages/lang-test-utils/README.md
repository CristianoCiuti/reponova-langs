# @reponova/lang-test-utils

Internal (not published) test helpers shared across `@reponova/lang-*` plugins.

Provides:

- `expectFileNode`, `expectSymbol`, `expectEdge`, `expectImport` - vitest-aware assertions on `FileExtraction`
- `findSymbol`, `findImport`, `findReference` - non-throwing lookups
- `symbolNames`, `importModules`, `referenceNames` - flat name listers for assertion error messages
- `loadFixture`, `fixturePath`, `listFixtures` - fixture file helpers
- `loadGrammar` - dynamic loader for tree-sitter WASM grammars (returns `null` when missing so the regex-fallback path is testable)

Consumed as source via `workspace:*` (no build step).
