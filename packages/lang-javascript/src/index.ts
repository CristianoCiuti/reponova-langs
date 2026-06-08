/**
 * @reponova/lang-javascript - entry point.
 *
 * Exposes a `LanguagePlugin` that handles JavaScript source files via
 * `tree-sitter-javascript.wasm`. Covered extensions:
 *
 *   .js   — standard JavaScript (CommonJS or ES modules)
 *   .mjs  — explicit ES modules (Node)
 *   .cjs  — explicit CommonJS (Node)
 *   .jsx  — JavaScript with JSX (React, Preact, …)
 *
 * Why one plugin for all four? Unlike TypeScript / TSX (which have two
 * distinct tree-sitter grammars: `tree-sitter-typescript` and
 * `tree-sitter-tsx`), the upstream `tree-sitter-javascript` grammar already
 * ships with native JSX support inline. A single WASM parses every JS dialect
 * we ship for, so a single plugin is the natural shape.
 *
 * Symbol-extraction and outline logic are shared verbatim with
 * `@reponova/lang-typescript` and `@reponova/lang-tsx` via the private
 * workspace package `@reponova/lang-typescript-core`. Bug fixes and feature
 * additions to the extractor propagate automatically across all three
 * plugins. TypeScript-only AST node kinds — `interface_declaration`,
 * `type_alias_declaration`, `enum_declaration`, generic parameters,
 * decorators — never appear in a JS parse tree, so the corresponding
 * branches of the shared extractor are no-ops here.
 *
 * Resolution candidates are widened so a JS file `import './foo'` correctly
 * enumerates every JS dialect we accept (e.g. `foo.js`, `foo.mjs`, `foo.cjs`,
 * `foo.jsx`, plus `foo/index.js` and so on). The host RepoNova resolver
 * picks the first hit on disk.
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
  "../grammars/tree-sitter-javascript.wasm",
);

const JS_EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx"] as const;

const JS_RESOLVE_CANDIDATES = [
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
] as const;

const JS_INDEX_CANDIDATES = [
  "index.js",
  "index.mjs",
  "index.cjs",
  "index.jsx",
] as const;

export const plugin: LanguagePlugin = {
  id: "javascript",
  fileType: "javascript",
  grammarPath,
  extractor: new TypescriptExtractor({
    languageId: "javascript",
    extensions: [...JS_EXTENSIONS],
    wasmFile: "tree-sitter-javascript.wasm",
    resolveCandidates: JS_RESOLVE_CANDIDATES,
    indexCandidates: JS_INDEX_CANDIDATES,
  }),
  outline: createTypescriptOutline({ wasmFile: "tree-sitter-javascript.wasm" }),
};

export { TypescriptExtractor };
export default plugin;
