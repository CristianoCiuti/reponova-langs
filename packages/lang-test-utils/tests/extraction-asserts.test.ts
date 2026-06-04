import { describe, expect, it } from 'vitest';
import type { FileExtraction } from 'reponova';
import {
  expectEdge,
  expectFileNode,
  expectImport,
  expectSymbol,
  findReference,
  findSymbol,
  importModules,
  symbolNames,
} from '../src/extraction-asserts.js';

const sample: FileExtraction = {
  filePath: 'foo/bar.py',
  language: 'python',
  fileNode: { kind: 'module', label: 'bar.py' },
  symbols: [
    {
      name: 'authenticate',
      qualifiedName: 'foo.bar.authenticate',
      kind: 'function',
      decorators: [],
      startLine: 10,
      endLine: 25,
      signature: 'authenticate(user)',
    },
    {
      name: 'User',
      qualifiedName: 'foo.bar.User',
      kind: 'class',
      decorators: [],
      startLine: 30,
      endLine: 50,
      bases: ['BaseUser'],
    },
  ],
  imports: [
    { module: 'os.path', names: ['join'], isWildcard: false, line: 1 },
    { module: '../utils', names: ['*'], isWildcard: true, line: 2 },
  ],
  references: [
    { name: 'fetchUser', fromSymbol: 'authenticate', kind: 'calls', line: 15 },
  ],
};

describe('extraction-asserts', () => {
  it('expectFileNode matches partial declarations', () => {
    expectFileNode(sample, { kind: 'module' });
    expectFileNode(sample, { label: 'bar.py' });
  });

  it('expectSymbol returns the symbol on match', () => {
    const sym = expectSymbol(sample, { name: 'authenticate', kind: 'function' });
    expect(sym.qualifiedName).toBe('foo.bar.authenticate');
  });

  it('expectSymbol checks optional fields when provided', () => {
    expectSymbol(sample, { name: 'User', kind: 'class', bases: ['BaseUser'] });
  });

  it('expectEdge finds matching references', () => {
    expectEdge(sample, { from: 'authenticate', to: 'fetchUser', kind: 'calls' });
  });

  it('expectImport supports names and wildcard checks', () => {
    expectImport(sample, { module: 'os.path', names: ['join'] });
    expectImport(sample, { module: '../utils', isWildcard: true });
  });

  it('find* helpers return undefined when nothing matches', () => {
    expect(findSymbol(sample, 'ghost')).toBeUndefined();
    expect(findReference(sample, 'authenticate', 'ghost')).toBeUndefined();
  });

  it('name listers preserve declaration order', () => {
    expect(symbolNames(sample)).toEqual(['authenticate', 'User']);
    expect(importModules(sample)).toEqual(['os.path', '../utils']);
  });
});
