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

interface ParserInstance {
  setLanguage: (lang: unknown) => void;
  parse: (src: string) => unknown;
}

interface ParserCtor {
  new (): ParserInstance;
}

interface LanguageStatic {
  load: (path: string) => Promise<unknown>;
}

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
    Parser: ParserCtor & { init?: () => Promise<void>; Language?: LanguageStatic };
    Language?: LanguageStatic;
    default?: ParserCtor & { init?: () => Promise<void>; Language?: LanguageStatic };
  };
  // web-tree-sitter 0.25.x exposes init() on the Parser class. Older
  // versions exposed it on the module's default export. Try both.
  const ParserClass = treeSitter.Parser ?? treeSitter.default;
  if (!ParserClass) throw new Error('web-tree-sitter: Parser export not found');
  if (typeof ParserClass.init === 'function') {
    await ParserClass.init();
  }
  const LanguageClass = treeSitter.Language ?? ParserClass.Language;
  if (!LanguageClass || typeof LanguageClass.load !== 'function') {
    throw new Error('web-tree-sitter: Language.load() not found');
  }
  const language = await LanguageClass.load(wasmPath);
  const parser = new ParserClass();
  parser.setLanguage(language);
  return {
    parser,
    parse: (source: string) => parser.parse(source),
  };
}
