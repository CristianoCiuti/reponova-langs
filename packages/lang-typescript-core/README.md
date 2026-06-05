# @reponova/lang-typescript-core

Internal workspace package. Hosts the shared TypeScript-family extractor and outline used by:

- [`@reponova/lang-typescript`](../lang-typescript) — pure `.ts` / `.mts` / `.cts` files via `tree-sitter-typescript.wasm`
- [`@reponova/lang-tsx`](../lang-tsx) — JSX-heavy `.tsx` files via `tree-sitter-tsx.wasm`

Both consumer plugins import the same `TypescriptExtractor` class and `createTypescriptOutline` factory and pass language-specific configuration (id, extensions, wasm filename, resolver candidates) at construction time. The plugins then bundle this package inline via `tsup --noExternal`, so consumers of the published npm tarballs see no trace of `@reponova/lang-typescript-core` (it is never published).

## Why a separate workspace package?

The TypeScript and TSX grammars from upstream `tree-sitter/tree-sitter-typescript` produce conflicting node sets at the boundary between expression `<` and JSX `<Tag>`. The reponova `LanguagePlugin` contract binds **one** `LanguageExtractor` (with one `wasmFile`) per plugin, so two plugins are needed. Sharing the extractor logic in a workspace package (rather than copy-pasting ~1k LOC) keeps the two plugins in lock-step on bug fixes and new TypeScript features.

## Layout

```
src/
  extractor.ts   # TypescriptExtractor (configurable)
  outline.ts     # createTypescriptOutline + default `typescript` LanguageSupport
  index.ts       # public barrel
tests/
  extractor.test.ts
  resolve-imports.test.ts
  fixtures.test.ts
  complex.test.ts
  fixtures/
    simple/      # ~50 LOC hand-written
    medium/      # ~500 LOC multi-file
    complex/     # OSS snapshot pinned at a specific commit
```

## Public API

```ts
import {
  TypescriptExtractor,
  type TypescriptExtractorOptions,
  createTypescriptOutline,
  typescript, // default LanguageSupport (TS-flavored)
} from "@reponova/lang-typescript-core";
```

## Not published to npm

Marked `"private": true`. CI hard-fails any attempt to publish it. Distribution to end users happens through `@reponova/lang-typescript` and `@reponova/lang-tsx` tarballs, which inline this code at build time.
