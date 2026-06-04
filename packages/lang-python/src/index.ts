/**
 * @reponova/lang-python — entry point.
 *
 * Exports the LanguagePlugin for Python support.
 */
import type { LanguagePlugin } from "reponova";
import { PythonExtractor } from "./extractor.js";
import { python as pythonOutline } from "./outline.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const grammarPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "../grammars/tree-sitter-python.wasm");

export const plugin: LanguagePlugin = {
  id: "python",
  extensions: [".py", ".pyw"],
  fileType: "python",
  grammarPath,
  extractor: new PythonExtractor(),
  outline: pythonOutline,
};

export { PythonExtractor };
