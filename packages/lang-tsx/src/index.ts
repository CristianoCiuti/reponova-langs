/**
 * @reponova/lang-tsx - entry point.
 *
 * Exposes a `LanguagePlugin` that handles `.tsx` (TypeScript + JSX) source
 * files via `tree-sitter-tsx.wasm`. Symbol-extraction and outline logic are
 * shared verbatim with `@reponova/lang-typescript`: both plugins reuse the
 * same `TypescriptExtractor` class against a different WASM grammar at
 * runtime, so feature parity (functions, classes, methods, hooks, generics,
 * decorators, JSDoc, ...) is automatic and bug fixes propagate to both.
 *
 * Resolution candidates are widened beyond the TypeScript flavor so a
 * `.tsx` file `import './foo'` correctly enumerates `foo.tsx`, `foo.ts`,
 * `foo.d.ts`, `foo/index.tsx`, `foo/index.ts`, etc. — the host RepoNova
 * resolver picks the first hit on disk.
 */
import type { LanguagePlugin } from "reponova";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TypescriptExtractor,
  createTypescriptOutline,
} from "@reponova/lang-typescript-core";

const grammarPath = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../grammars/tree-sitter-tsx.wasm",
);

const TSX_RESOLVE_CANDIDATES = [
  ".tsx",
  ".ts",
  ".mts",
  ".cts",
  ".d.ts",
] as const;

const TSX_INDEX_CANDIDATES = [
  "index.tsx",
  "index.ts",
  "index.mts",
  "index.cts",
  "index.d.ts",
] as const;

export const plugin: LanguagePlugin = {
  id: "tsx",
  fileType: "tsx",
  grammarPath,
  extractor: new TypescriptExtractor({
    languageId: "tsx",
    extensions: [".tsx"],
    wasmFile: "tree-sitter-tsx.wasm",
    resolveCandidates: TSX_RESOLVE_CANDIDATES,
    indexCandidates: TSX_INDEX_CANDIDATES,
  }),
  outline: createTypescriptOutline({ wasmFile: "tree-sitter-tsx.wasm" }),
};

export { TypescriptExtractor };
export default plugin;
