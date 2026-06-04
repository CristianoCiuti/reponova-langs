/**
 * @reponova/lang-test-utils - public API
 *
 * Shared helpers consumed in tests of @reponova/lang-* plugins.
 * Source-only package: importers use it directly via `workspace:*`.
 */

export {
  expectFileNode,
  expectSymbol,
  expectEdge,
  expectImport,
  findSymbol,
  findImport,
  findReference,
  symbolNames,
  importModules,
  referenceNames,
  type ExpectedFileNode,
  type ExpectedSymbol,
  type ExpectedEdge,
  type ExpectedImport,
} from './extraction-asserts.js';

export { loadFixture, fixturePath, listFixtures } from './fixture-loader.js';

export { loadGrammar, type LoadedGrammar } from './grammar-loader.js';
