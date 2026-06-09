/**
 * @reponova/lang-c — entry point.
 *
 * Exports the LanguagePlugin for C support.
 */
import type { LanguagePlugin } from "reponova";
import { CExtractor } from "./extractor.js";
import { c as cOutline } from "./outline.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const grammarPath = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../grammars/tree-sitter-c.wasm",
);

export const plugin: LanguagePlugin = {
  id: "c",
  fileType: "c",
  grammarPath,
  extractor: new CExtractor(),
  outline: cOutline,
};

export { CExtractor };
