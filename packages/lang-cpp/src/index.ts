/**
 * @reponova/lang-cpp — entry point.
 *
 * Exposes a `LanguagePlugin` that handles C++ source files
 * (`.cpp/.cc/.cxx/.c++/.hpp/.hh/.hxx/.h++`) via `tree-sitter-cpp.wasm`.
 * The extraction logic lives in `CppExtractor`, which subclasses
 * `CFamilyExtractor` from the workspace-internal
 * `@reponova/lang-c-core` (bundled inline via `tsup --noExternal` so
 * the published tarball is fully self-contained).
 */
import type { LanguagePlugin } from "reponova";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CppExtractor } from "./extractor.js";
import { cpp as cppOutline } from "./outline.js";

const grammarPath = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../grammars/tree-sitter-cpp.wasm",
);

export const plugin: LanguagePlugin = {
  id: "cpp",
  fileType: "cpp",
  grammarPath,
  extractor: new CppExtractor(),
  outline: cppOutline,
};

export { CppExtractor };
export default plugin;
