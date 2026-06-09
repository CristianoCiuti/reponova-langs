/**
 * @reponova/lang-java — entry point.
 *
 * Exports the LanguagePlugin for Java support.
 */
import type { LanguagePlugin } from "reponova";
import { JavaExtractor } from "./extractor.js";
import { java as javaOutline } from "./outline.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const grammarPath = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../grammars/tree-sitter-java.wasm",
);

export const plugin: LanguagePlugin = {
  id: "java",
  fileType: "java",
  grammarPath,
  extractor: new JavaExtractor(),
  outline: javaOutline,
};

export { JavaExtractor };
