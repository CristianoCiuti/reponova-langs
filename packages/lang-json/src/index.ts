/**
 * @reponova/lang-json — entry point.
 *
 * Schema-aware JSON / JSONC support for RepoNova. Recognises the canonical
 * configuration files of the JS/TS ecosystem (`package.json`, `tsconfig*`,
 * `nx.json`, `project.json`, `lerna.json`, `turbo.json`) and falls back to
 * a generic top-level-keys-as-symbols extraction for anything else.
 *
 * Why a dedicated plugin instead of the generic markdown/text fallback?
 * `package.json` and `tsconfig*` are the real entry points of dependency
 * and build graphs — without surfacing their structure RepoNova would
 * miss "App imports Lib via tsconfig path alias" / "Service depends on
 * @octo/auth" relationships entirely.
 */
import type { LanguagePlugin } from "reponova";
import { JsonExtractor, detectJsonKind, type JsonKind } from "./extractor.js";

export const plugin: LanguagePlugin = {
  id: "json",
  extensions: [".json", ".jsonc"],
  fileType: "json",
  extractor: new JsonExtractor(),
};

export { JsonExtractor, detectJsonKind, type JsonKind };
export default plugin;
