/**
 * @reponova/lang-json — entry point.
 *
 * Schema-aware JSON / JSONC support for RepoNova. Recognises the
 * canonical configuration files of the JS/TS ecosystem (`package.json`,
 * `tsconfig*`, `nx.json`, `project.json`, `lerna.json`, `turbo.json`)
 * and falls back to a generic top-level-keys-as-symbols extraction for
 * anything else.
 */
import type { LanguagePlugin } from "reponova";
import {
  DEFAULT_MAX_GENERIC_KEYS,
  JsonExtractor,
  detectJsonKind,
  type JsonExtractorOptions,
  type JsonKind,
} from "./extractor.js";

export const plugin: LanguagePlugin = {
  id: "json",
  extensions: [".json", ".jsonc"],
  fileType: "json",
  configDefaults: { maxGenericKeys: DEFAULT_MAX_GENERIC_KEYS },
  extractor: new JsonExtractor(),
};

export {
  DEFAULT_MAX_GENERIC_KEYS,
  JsonExtractor,
  detectJsonKind,
  type JsonExtractorOptions,
  type JsonKind,
};
export default plugin;
