/**
 * Black-box tests for the bootstrap-plugin CLI focused on argument parsing
 * and pre-flight validation. None of these tests touch npm / git / gh.
 *
 * Behaviours covered:
 *   - argument parsing (--help, missing arg, unknown flag, double positional)
 *   - package.json validation (private, non-scoped, missing fields)
 *
 * For network/IO-bound steps (publish, trust, tag, release) we rely on the
 * idempotency contract documented in the source: each step short-circuits
 * when its effect is already visible. Those paths are exercised in CI when
 * the publish matrix re-runs after a manual bootstrap.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '..', 'src', 'index.ts');

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: readonly string[], cwd?: string): RunResult {
  const r = spawnSync('npx', ['tsx', SCRIPT, ...args], {
    cwd: cwd ?? resolve(HERE, '..'),
    encoding: 'utf8',
    shell: true,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

describe('bootstrap-plugin CLI: argument parsing', () => {
  it('--help exits 0 and prints usage', () => {
    const r = runCli(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage: bootstrap-plugin/);
    expect(r.stdout).toMatch(/--skip-tag/);
    expect(r.stdout).toMatch(/--skip-release/);
  });

  it('missing positional exits 2', () => {
    const r = runCli([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/missing required argument/);
  });

  it('unknown flag exits 2', () => {
    const r = runCli(['--this-flag-does-not-exist']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown argument/);
  });

  it('extra positional exits 2', () => {
    const r = runCli(['lang-typescript', 'extra-arg']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unexpected positional argument/);
  });
});

// Build a fake monorepo at a temp path with the bootstrap-plugin script
// re-rooted via a symlink-like layout so we can drive package.json validation
// without touching the real workspace. We accomplish this by spawning tsx
// with the SCRIPT path but a CWD that points into a fake monorepo whose
// `tools/bootstrap-plugin/src/index.ts` would be at the same relative depth.
//
// Since the real script computes repoRoot() from `import.meta.url`, those
// absolute paths can't be remapped at runtime. The validation tests below
// therefore operate on the REAL monorepo: they target package directory
// names that don't exist or that intentionally violate the contract, then
// inspect stderr for the expected validation error.
describe('bootstrap-plugin CLI: package.json validation', () => {
  it('rejects a non-existent package directory with a clear error', () => {
    const r = runCli(['lang-this-does-not-exist', '--yes']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/cannot read .*package\.json/);
  });

  it('rejects a private package by name (the @reponova/lang-test-utils workspace member)', () => {
    // Symlink that package into packages/ for this test? Too invasive.
    // Instead we validate via a synthetic package planted inside packages/
    // for the duration of the test, with a unique name to avoid collisions.
    const repoRoot = resolve(HERE, '..', '..', '..');
    const fakePkgDir = resolve(repoRoot, 'packages', '__lang-test-private');
    mkdirSync(fakePkgDir, { recursive: true });
    writeFileSync(
      resolve(fakePkgDir, 'package.json'),
      JSON.stringify(
        {
          name: '@reponova/lang-test-private',
          version: '0.0.0',
          private: true,
        },
        null,
        2,
      ),
      'utf8',
    );
    try {
      const r = runCli(['__lang-test-private', '--yes']);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/marked private/);
    } finally {
      rmSync(fakePkgDir, { recursive: true, force: true });
    }
  });

  it('rejects a package whose name is not @reponova/lang-*', () => {
    const repoRoot = resolve(HERE, '..', '..', '..');
    const fakePkgDir = resolve(repoRoot, 'packages', '__lang-test-wrong-scope');
    mkdirSync(fakePkgDir, { recursive: true });
    writeFileSync(
      resolve(fakePkgDir, 'package.json'),
      JSON.stringify(
        {
          name: '@somebody-else/lang-x',
          version: '0.1.0',
        },
        null,
        2,
      ),
      'utf8',
    );
    try {
      const r = runCli(['__lang-test-wrong-scope', '--yes']);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/does not match @reponova\/lang-/);
    } finally {
      rmSync(fakePkgDir, { recursive: true, force: true });
    }
  });

  it('rejects a package without a version field', () => {
    const repoRoot = resolve(HERE, '..', '..', '..');
    const fakePkgDir = resolve(repoRoot, 'packages', '__lang-test-no-version');
    mkdirSync(fakePkgDir, { recursive: true });
    writeFileSync(
      resolve(fakePkgDir, 'package.json'),
      JSON.stringify({ name: '@reponova/lang-test-noversion' }, null, 2),
      'utf8',
    );
    try {
      const r = runCli(['__lang-test-no-version', '--yes']);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/has no "version"/);
    } finally {
      rmSync(fakePkgDir, { recursive: true, force: true });
    }
  });
});

// Sanity guard: the temp-fixture tests above plant directories under the
// real `packages/` directory. If a previous test run was killed mid-flight
// the cleanup would not have run. This `beforeAll` removes any orphaned
// fixture so the next run starts from a clean slate.
const STALE_FIXTURES = [
  '__lang-test-private',
  '__lang-test-wrong-scope',
  '__lang-test-no-version',
];
beforeAll(() => {
  const repoRoot = resolve(HERE, '..', '..', '..');
  for (const name of STALE_FIXTURES) {
    rmSync(resolve(repoRoot, 'packages', name), {
      recursive: true,
      force: true,
    });
  }
});
afterAll(() => {
  const repoRoot = resolve(HERE, '..', '..', '..');
  for (const name of STALE_FIXTURES) {
    rmSync(resolve(repoRoot, 'packages', name), {
      recursive: true,
      force: true,
    });
  }
});
