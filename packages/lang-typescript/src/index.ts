/**
 * @reponova/lang-typescript - entry point.
 *
 * Exposes a `LanguagePlugin` that handles `.ts/.mts/.cts` source files via
 * `tree-sitter-typescript.wasm`. JSX-heavy `.tsx` is intentionally NOT in
 * the supported extension list for v0.1.0 - see README "Limitations".
 */
import type { LanguagePlugin } from "reponova";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TypescriptExtractor } from "./extractor.js";
import { typescript as typescriptOutline } from "./outline.js";

const grammarPath = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../grammars/tree-sitter-typescript.wasm",
);

export const plugin: LanguagePlugin = {
  id: "typescript",
  extensions: [".ts", ".mts", ".cts"],
  fileType: "typescript",
  grammarPath,
  extractor: new TypescriptExtractor(),
  outline: typescriptOutline,
};

export { TypescriptExtractor };
export default plugin;
