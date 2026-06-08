/**
 * @reponova/lang-typescript - entry point.
 *
 * Exposes a `LanguagePlugin` that handles `.ts/.mts/.cts` source files via
 * `tree-sitter-typescript.wasm`.
 *
 * JSX-heavy `.tsx` files are handled by the sibling `@reponova/lang-tsx`
 * plugin, which reuses the same extractor against `tree-sitter-tsx.wasm`.
 */
import type { LanguagePlugin } from "reponova";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TypescriptExtractor,
  typescript as typescriptOutline,
} from "@reponova/lang-typescript-core";

const grammarPath = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../grammars/tree-sitter-typescript.wasm",
);

export const plugin: LanguagePlugin = {
  id: "typescript",
  fileType: "typescript",
  grammarPath,
  extractor: new TypescriptExtractor(),
  outline: typescriptOutline,
};

export { TypescriptExtractor };
export default plugin;
