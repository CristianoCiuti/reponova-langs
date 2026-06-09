/**
 * @reponova/lang-c-core — public barrel.
 *
 * Internal workspace package shared between `@reponova/lang-c` and
 * `@reponova/lang-cpp`. See README.md for context.
 */

export {
  CFamilyExtractor,
  type CFamilyExtractorOptions,
  type CFamilyKind,
  C_TOP_LEVEL_DECLARATIONS,
  PREPROC_CONDITIONAL_CONTAINERS,
  resolveCInclude,
  findFunctionDeclarator,
  hasFunctionDeclarator,
  extractDeclaratorName,
  extractQualifiedScope,
  collectStorageAndQualifierKeywords,
  simplifyCallee,
  posixBasename,
  posixDirname,
  posixJoin,
  filePathToModule,
  stripStringQuotes,
  cleanDoxyBlock,
  stripBlockComment,
  stripLineDoxy,
  cleanFirstLine,
  truncate,
} from "./extractor.js";

export {
  createCFamilyOutline,
  type CFamilyOutlineOptions,
  c,
} from "./outline.js";
