/**
 * Grammar loader.
 *
 * Wraps `web-tree-sitter` to parse a source file with a given .wasm grammar
 * for use inside extractor tests. Returns `null` when the grammar file is
 * missing so tests can verify the regex-fallback path without conditionals.
 *
 * Implementation note: `web-tree-sitter` is imported dynamically so that
 * @reponova/lang-test-utils stays usable in regex-only plugins (where pulling
 * the WASM runtime as a hard dependency would be wasteful).
 */

import { existsSync } from 'node:fs';

export interface LoadedGrammar {
  /** Tree-sitter Parser instance, already configured with the grammar. */
  parser: unknown;
  /** Parse a source string into a SyntaxTree (or null if parsing fails). */
  parse: (source: string) => unknown;
}

/**
 * Load a tree-sitter WASM grammar and return a configured parser.
 * Returns `null` if the grammar file does not exist (lets tests assert the
 * regex-fallback path explicitly).
 */
export async function loadGrammar(
  wasmPath: string,
): Promise<LoadedGrammar | null> {
  if (!existsSync(wasmPath)) {
    return null;
  }
  const treeSitter = (await import('web-tree-sitter')) as unknown as {
    Parser: new () => { setLanguage: (lang: unknown) => void; parse: (src: string) => unknown };
    Language: { load: (path: string) => Promise<unknown> };
    default?: { init: () => Promise<void> };
    init?: () => Promise<void>;
  };
  const initFn = treeSitter.init ?? treeSitter.default?.init;
  if (typeof initFn === 'function') {
    await initFn();
  }
  const language = await treeSitter.Language.load(wasmPath);
  const parser = new treeSitter.Parser();
  parser.setLanguage(language);
  return {
    parser,
    parse: (source: string) => parser.parse(source),
  };
}
