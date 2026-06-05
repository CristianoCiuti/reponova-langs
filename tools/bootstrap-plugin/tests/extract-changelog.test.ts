/**
 * Unit tests for the shared `.github/scripts/extract-changelog.mjs` parser.
 * Both the Release workflow and the bootstrap-plugin CLI rely on it for
 * release notes generation, so its behaviour around section boundaries and
 * missing versions matters.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// @ts-expect-error - .mjs has no .d.ts but exports `extractSection` for tests
import { extractSection } from '../../../.github/scripts/extract-changelog.mjs';

const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '.github',
  'scripts',
  'extract-changelog.mjs',
);

const SAMPLE = `# @reponova/lang-foo

## 0.2.1

### Patch Changes

- abc1234: Source the bundled tree-sitter grammar from upstream.

  Functionally a no-op for consumers.

## 0.2.0

### Minor Changes

- def5678: Migrate to the unified \`reponova-langs\` monorepo.

  - bullet 1
  - bullet 2

## 0.1.0

### Minor Changes

- ghi9012: Initial release.
`;

describe('extractSection', () => {
  it('returns the body of the requested section without the header', () => {
    const out = extractSection(SAMPLE, '0.2.1');
    expect(out).toContain('### Patch Changes');
    expect(out).toContain('abc1234: Source the bundled tree-sitter grammar');
    expect(out).toContain('Functionally a no-op for consumers.');
    expect(out).not.toMatch(/^##\s+0\.2\.1/m);
  });

  it('stops at the next "## " heading and does not leak content from later sections', () => {
    const out = extractSection(SAMPLE, '0.2.1');
    expect(out).not.toContain('0.2.0');
    expect(out).not.toContain('def5678');
    expect(out).not.toContain('Migrate to the unified');
  });

  it('captures everything up to EOF for the last section', () => {
    const out = extractSection(SAMPLE, '0.1.0');
    expect(out).toContain('ghi9012: Initial release');
    expect(out?.trim().endsWith('Initial release.')).toBe(true);
  });

  it('returns null for a missing version', () => {
    expect(extractSection(SAMPLE, '9.9.9')).toBeNull();
  });

  it('matches headers with trailing whitespace', () => {
    const padded = '## 1.0.0   \n\nbody\n';
    expect(extractSection(padded, '1.0.0')?.trim()).toBe('body');
  });

  it('does not match headers that are a strict prefix (e.g. 0.2 vs 0.2.0)', () => {
    expect(extractSection(SAMPLE, '0.2')).toBeNull();
  });

  it('handles CRLF line endings', () => {
    const crlf = SAMPLE.replace(/\n/g, '\r\n');
    const out = extractSection(crlf, '0.2.0');
    expect(out).toContain('Migrate to the unified');
    expect(out).not.toContain('0.1.0');
  });
});

describe('extract-changelog.mjs CLI', () => {
  it('prints the section to stdout and exits 0 when version exists', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'extract-changelog-'));
    try {
      const file = resolve(dir, 'CHANGELOG.md');
      writeFileSync(file, SAMPLE, 'utf8');
      const r = spawnSync('node', [SCRIPT, file, '0.2.1'], {
        encoding: 'utf8',
        shell: true,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('### Patch Changes');
      expect(r.stdout).toContain('abc1234');
      expect(r.stdout).not.toContain('def5678');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 with a stderr message for a missing version', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'extract-changelog-'));
    try {
      const file = resolve(dir, 'CHANGELOG.md');
      writeFileSync(file, SAMPLE, 'utf8');
      const r = spawnSync('node', [SCRIPT, file, '9.9.9'], {
        encoding: 'utf8',
        shell: true,
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('not found');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 with a stderr message when arguments are missing', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8', shell: true });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/usage:/i);
  });

  it('exits 2 when the CHANGELOG file does not exist', () => {
    const r = spawnSync(
      'node',
      [SCRIPT, '/definitely/not/here/CHANGELOG.md', '1.0.0'],
      { encoding: 'utf8', shell: true },
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('cannot read');
  });
});
