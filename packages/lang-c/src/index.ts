/**
 * @reponova/lang-c — entry point.
 *
 * Exposes a `LanguagePlugin` that handles `.c` / `.h` source files via
 * `tree-sitter-c.wasm`. The extraction logic itself lives in the
 * workspace-internal `@reponova/lang-c-core`, which is bundled inline
 * via `tsup --noExternal`; consumers of the published npm tarball see
 * a fully self-contained build.
 *
 * The sibling `@reponova/lang-cpp` plugin uses the same core package
 * and extends `CFamilyExtractor` to add C++-specific extraction
 * (namespaces, classes, templates, …).
 */
import type { LanguagePlugin } from "reponova";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CFamilyExtractor,
  c as cOutline,
} from "@reponova/lang-c-core";

const grammarPath = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../grammars/tree-sitter-c.wasm",
);

const extractor = new CFamilyExtractor({
  languageId: "c",
  extensions: [".c", ".h"],
  wasmFile: "tree-sitter-c.wasm",
});

export const plugin: LanguagePlugin = {
  id: "c",
  fileType: "c",
  grammarPath,
  extractor,
  outline: cOutline,
};

export { CFamilyExtractor };
export default plugin;
