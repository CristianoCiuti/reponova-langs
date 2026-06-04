/**
 * Assertion helpers that operate on `FileExtraction` produced by language
 * extractors. They wrap `expect()` calls so failures point at the helper
 * invocation in the test file rather than a deep equality blob.
 */

import { expect } from 'vitest';
import type {
  FileExtraction,
  FileNodeDeclaration,
  ImportDeclaration,
  SymbolNode,
  SymbolReference,
} from 'reponova';

export interface ExpectedFileNode extends Partial<FileNodeDeclaration> {}

export interface ExpectedSymbol {
  name: string;
  kind?: string;
  parent?: string | null;
  signature?: string;
  startLine?: number;
  endLine?: number;
  bases?: string[];
}

export interface ExpectedEdge {
  /** Name of the originating symbol (matches `SymbolReference.fromSymbol`). */
  from: string;
  /** Name of the target symbol (matches `SymbolReference.name`). */
  to: string;
  /** Edge type (matches `SymbolReference.kind`). */
  kind: SymbolReference['kind'];
}

export interface ExpectedImport {
  module: string;
  names?: string[];
  isWildcard?: boolean;
  isExport?: boolean;
}

export function expectFileNode(
  extraction: FileExtraction,
  expected: ExpectedFileNode,
): void {
  expect(extraction.fileNode, 'fileNode must be declared').toBeDefined();
  for (const [key, value] of Object.entries(expected) as Array<
    [keyof FileNodeDeclaration, unknown]
  >) {
    expect(
      extraction.fileNode[key],
      `fileNode.${String(key)} mismatch`,
    ).toEqual(value);
  }
}

export function expectSymbol(
  extraction: FileExtraction,
  expected: ExpectedSymbol,
): SymbolNode {
  const match = findSymbol(extraction, expected.name);
  expect(
    match,
    `expected symbol "${expected.name}" not found. Available: [${symbolNames(extraction).join(', ')}]`,
  ).toBeDefined();
  if (expected.kind !== undefined) {
    expect(match!.kind, `symbol "${expected.name}" kind mismatch`).toBe(
      expected.kind,
    );
  }
  if (expected.parent !== undefined) {
    expect(
      match!.parent ?? null,
      `symbol "${expected.name}" parent mismatch`,
    ).toBe(expected.parent);
  }
  if (expected.signature !== undefined) {
    expect(
      match!.signature,
      `symbol "${expected.name}" signature mismatch`,
    ).toBe(expected.signature);
  }
  if (expected.startLine !== undefined) {
    expect(
      match!.startLine,
      `symbol "${expected.name}" startLine mismatch`,
    ).toBe(expected.startLine);
  }
  if (expected.endLine !== undefined) {
    expect(
      match!.endLine,
      `symbol "${expected.name}" endLine mismatch`,
    ).toBe(expected.endLine);
  }
  if (expected.bases !== undefined) {
    expect(
      match!.bases ?? [],
      `symbol "${expected.name}" bases mismatch`,
    ).toEqual(expected.bases);
  }
  return match!;
}

export function expectEdge(
  extraction: FileExtraction,
  expected: ExpectedEdge,
): SymbolReference {
  const match = extraction.references.find(
    (ref) =>
      ref.fromSymbol === expected.from &&
      ref.name === expected.to &&
      ref.kind === expected.kind,
  );
  expect(
    match,
    `expected edge ${expected.from} --${expected.kind}--> ${expected.to} not found. ` +
      `Available: [${extraction.references
        .map((r) => `${r.fromSymbol} --${r.kind}--> ${r.name}`)
        .join(', ')}]`,
  ).toBeDefined();
  return match!;
}

export function expectImport(
  extraction: FileExtraction,
  expected: ExpectedImport,
): ImportDeclaration {
  const match = extraction.imports.find((imp) => imp.module === expected.module);
  expect(
    match,
    `expected import from "${expected.module}" not found. Available: [${importModules(extraction).join(', ')}]`,
  ).toBeDefined();
  if (expected.names !== undefined) {
    expect(
      match!.names,
      `import "${expected.module}" names mismatch`,
    ).toEqual(expected.names);
  }
  if (expected.isWildcard !== undefined) {
    expect(
      match!.isWildcard,
      `import "${expected.module}" isWildcard mismatch`,
    ).toBe(expected.isWildcard);
  }
  if (expected.isExport !== undefined) {
    expect(
      match!.isExport ?? false,
      `import "${expected.module}" isExport mismatch`,
    ).toBe(expected.isExport);
  }
  return match!;
}

export function findSymbol(
  extraction: FileExtraction,
  name: string,
): SymbolNode | undefined {
  return extraction.symbols.find((sym) => sym.name === name);
}

export function findImport(
  extraction: FileExtraction,
  module: string,
): ImportDeclaration | undefined {
  return extraction.imports.find((imp) => imp.module === module);
}

export function findReference(
  extraction: FileExtraction,
  from: string,
  to: string,
): SymbolReference | undefined {
  return extraction.references.find(
    (ref) => ref.fromSymbol === from && ref.name === to,
  );
}

export function symbolNames(extraction: FileExtraction): string[] {
  return extraction.symbols.map((sym) => sym.name);
}

export function importModules(extraction: FileExtraction): string[] {
  return extraction.imports.map((imp) => imp.module);
}

export function referenceNames(extraction: FileExtraction): string[] {
  return extraction.references.map((ref) => `${ref.fromSymbol}->${ref.name}`);
}
