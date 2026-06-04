/**
 * File templates rendered by the scaffold CLI.
 *
 * Each template returns a string with `{{id}}`, `{{Id}}`, `{{description}}`,
 * `{{extensionsArray}}`, `{{fileNodeKind}}` placeholders pre-substituted.
 */

import type { Archetype } from './args.js';

export interface RenderContext {
  id: string;
  extensions: string[];
  archetype: Archetype;
  description: string;
}

export function renderFiles(ctx: RenderContext): Record<string, string> {
  const vars = buildVars(ctx);
  return {
    'package.json': packageJson(vars),
    'tsconfig.json': tsconfigJson(),
    'tsup.config.ts': tsupConfig(),
    'vitest.config.ts': vitestConfig(),
    'src/index.ts': indexTs(vars),
    'src/extractor.ts': extractorTs(vars),
    'tests/extractor.test.ts': extractorTest(vars),
    'tests/resolve-imports.test.ts': resolveImportsTest(vars),
    'tests/fixtures/simple/.gitkeep': '',
    'tests/fixtures/medium/.gitkeep': '',
    'tests/fixtures/complex/.gitkeep': '',
    'README.md': readme(vars),
    'LICENSE': license(),
  };
}

interface Vars {
  id: string;
  Id: string;
  ClassPrefix: string;
  description: string;
  extensionsArray: string;
  fileNodeKind: 'module' | 'diagram';
  isTreeSitter: boolean;
}

function buildVars(ctx: RenderContext): Vars {
  const Id = ctx.id.charAt(0).toUpperCase() + ctx.id.slice(1);
  const ClassPrefix = ctx.id
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  return {
    id: ctx.id,
    Id,
    ClassPrefix,
    description: ctx.description,
    extensionsArray: JSON.stringify(ctx.extensions),
    fileNodeKind: ctx.archetype === 'A' ? 'module' : 'diagram',
    isTreeSitter: ctx.archetype === 'A',
  };
}

function packageJson(v: Vars): string {
  const grammarField = v.isTreeSitter
    ? `,\n    "grammar": "./grammars/tree-sitter-${v.id}.wasm"`
    : '';
  const filesField = v.isTreeSitter
    ? '["dist", "grammars", "README.md", "LICENSE"]'
    : '["dist", "README.md", "LICENSE"]';
  const wasmDep = v.isTreeSitter
    ? ',\n    "web-tree-sitter": "^0.25.10"'
    : '';
  return (
    JSON.stringify(
      JSON.parse(`{
  "name": "@reponova/lang-${v.id}",
  "version": "0.0.0",
  "description": "${v.description}",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "files": ${filesField},
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "pnpm run build"
  },
  "peerDependencies": {
    "reponova": "^0.4.0"
  },
  "devDependencies": {
    "@reponova/lang-test-utils": "workspace:*",
    "reponova": "^0.4.3"${wasmDep}
  },
  "reponova": {
    "type": "language",
    "id": "${v.id}",
    "extensions": ${v.extensionsArray}${grammarField}
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/CristianoCiuti/reponova-langs.git",
    "directory": "packages/lang-${v.id}"
  },
  "homepage": "https://github.com/CristianoCiuti/reponova-langs/tree/main/packages/lang-${v.id}"
}`),
      null,
      2,
    ) + '\n'
  );
}

function tsconfigJson(): string {
  return `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
`;
}

function tsupConfig(): string {
  return `import { defineConfig } from 'tsup';
import { baseConfig } from '../../tsup.base';

export default defineConfig(baseConfig);
`;
}

function vitestConfig(): string {
  return `import { defineConfig } from 'vitest/config';
import { baseTestConfig } from '../../vitest.config.base';

export default defineConfig(baseTestConfig);
`;
}

function indexTs(v: Vars): string {
  const grammarBlock = v.isTreeSitter
    ? `import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const grammarPath = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../grammars/tree-sitter-${v.id}.wasm',
);

`
    : '';
  const grammarPathField = v.isTreeSitter ? '\n  grammarPath,' : '';
  return `/**
 * @reponova/lang-${v.id} - entry point.
 */
import type { LanguagePlugin } from 'reponova';
import { ${v.ClassPrefix}Extractor } from './extractor.js';

${grammarBlock}export const plugin: LanguagePlugin = {
  id: '${v.id}',
  extensions: ${v.extensionsArray},
  fileType: '${v.id}',${grammarPathField}
  extractor: new ${v.ClassPrefix}Extractor(),
};

export { ${v.ClassPrefix}Extractor };
export default plugin;
`;
}

function extractorTs(v: Vars): string {
  const wasmField = v.isTreeSitter
    ? `\n  readonly wasmFile = 'tree-sitter-${v.id}.wasm';`
    : '';
  return `import type {
  FileExtraction,
  LanguageExtractor,
  SyntaxTree,
} from 'reponova';

/**
 * TODO: implement the ${v.Id} extractor.
 * See INTEGRATION-PLAN.md section 8 for standards and the existing
 * @reponova/lang-python plugin as a tree-sitter reference (archetype A),
 * @reponova/lang-plantuml for regex archetype B,
 * @reponova/lang-svg for regex archetype C.
 */
export class ${v.ClassPrefix}Extractor implements LanguageExtractor {
  readonly languageId = '${v.id}';
  readonly extensions = ${v.extensionsArray};${wasmField}

  extract(
    _tree: SyntaxTree | null,
    _sourceCode: string,
    filePath: string,
  ): FileExtraction {
    return {
      filePath,
      language: this.languageId,
      fileNode: { kind: '${v.fileNodeKind}' },
      symbols: [],
      imports: [],
      references: [],
    };
  }

  resolveImportPath(_importModule: string, _currentFilePath: string): string[] {
    return [];
  }
}
`;
}

function extractorTest(v: Vars): string {
  return `import { describe, it } from 'vitest';
import { expectFileNode } from '@reponova/lang-test-utils';
import { ${v.ClassPrefix}Extractor } from '../src/extractor.js';

describe('${v.ClassPrefix}Extractor', () => {
  it('produces a fileNode of the expected kind', () => {
    const extractor = new ${v.ClassPrefix}Extractor();
    const extraction = extractor.extract(null, '', 'sample${v.extensionsArray.replace(/\[|\]|"/g, '').split(',')[0]}');
    expectFileNode(extraction, { kind: '${v.fileNodeKind}' });
  });

  it.todo('extracts simple fixture symbols');
  it.todo('extracts medium fixture imports');
  it.todo('extracts complex fixture references');
});
`;
}

function resolveImportsTest(v: Vars): string {
  return `import { describe, expect, it } from 'vitest';
import { ${v.ClassPrefix}Extractor } from '../src/extractor.js';

describe('${v.ClassPrefix}Extractor.resolveImportPath', () => {
  it('returns an empty array for external imports', () => {
    const extractor = new ${v.ClassPrefix}Extractor();
    expect(extractor.resolveImportPath('external-pkg', 'foo/bar')).toEqual([]);
  });

  it.todo('resolves relative imports');
  it.todo('resolves project-internal imports');
});
`;
}

function readme(v: Vars): string {
  return `# @reponova/lang-${v.id}

${v.description}

## Install

\`\`\`bash
reponova lang add @reponova/lang-${v.id}
\`\`\`

## What it extracts

- **Symbols**: TODO
- **Edges**: TODO
- **File node kind**: \`${v.fileNodeKind}\`

## Configuration in \`reponova.yml\`

\`\`\`yaml
plugins:
  ${v.id}:
    enabled: true
\`\`\`

## Limitations

- TODO
`;
}

function license(): string {
  return `MIT License

Copyright (c) 2026 Cristiano Ciuti and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}
