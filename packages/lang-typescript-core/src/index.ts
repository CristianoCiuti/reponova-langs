/**
 * @reponova/lang-typescript-core - public barrel.
 *
 * Internal workspace package shared between `@reponova/lang-typescript` and
 * `@reponova/lang-tsx`. See README.md for context.
 */
export {
  TypescriptExtractor,
  type TypescriptExtractorOptions,
  DEFAULT_TS_EXTENSIONS,
  DEFAULT_RESOLVE_CANDIDATES,
  DEFAULT_INDEX_CANDIDATES,
} from "./extractor.js";

export {
  createTypescriptOutline,
  type TypescriptOutlineOptions,
  typescript,
} from "./outline.js";
