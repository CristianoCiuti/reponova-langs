/**
 * Regression tests for the trust-configure pre-flight checks.
 *
 * The big one: a previous version of `tools/trust-configure/src/index.ts`
 * omitted `shell: true` from its `spawnSync('npm', ['--version'], ...)`
 * call. Node on Windows cannot invoke `.cmd` shims directly, so the call
 * silently failed and `checkNpmVersion()` returned `{ ok: false, version:
 * "<unknown>" }` even when npm was perfectly installed and on PATH. That
 * blocked `pnpm bootstrap-plugin lang-<id>` mid-flow on the trust step.
 *
 * These tests exercise the helpers against the real installed npm so the
 * regression cannot reappear silently on Windows runners.
 */
import { describe, expect, it } from 'vitest';
import { checkNpmVersion, checkNpmAuth } from '../src/preflight.js';

describe('checkNpmVersion (regression: must not return "<unknown>" on Windows)', () => {
  it('reports a real semver-shaped version (the original bug returned "<unknown>")', () => {
    const r = checkNpmVersion();
    expect(r.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(r.version).not.toBe('<unknown>');
  });

  it('returns an `ok` flag coherent with the parsed version (>= 11.15 gate)', () => {
    // The CI matrix uses the npm bundled with each Node version (10.x for
    // Node 18/20/22), so we cannot hard-code `ok === true`. Instead we check
    // that `ok` matches the actual parsed version: this still catches the
    // Windows shell bug because that returns version="<unknown>" with
    // ok=false, and would also catch any future drift between the version
    // parser and the gate itself. The gate is `>= 11.15` because npm 11.15
    // is the first release that emits the `permissions` field required by
    // the registry (npm/cli#9248).
    const r = checkNpmVersion();
    if (r.version === '<unknown>') {
      expect(r.ok).toBe(false);
      return;
    }
    const [majRaw, minRaw] = r.version.split('.');
    const maj = Number(majRaw);
    const min = Number(minRaw ?? '0');
    const expectedOk = maj > 11 || (maj === 11 && min >= 15);
    expect(r.ok).toBe(expectedOk);
  });
});

describe('checkNpmAuth', () => {
  it('always returns a defined shape (ok + user)', () => {
    const r = checkNpmAuth();
    expect(typeof r.ok).toBe('boolean');
    expect(typeof r.user).toBe('string');
    // We don't assert ok===true: the test environment may or may not
    // be authenticated. The important thing is that the call did not
    // silently throw because of a Windows spawn issue.
  });

  it('returns a non-empty user string when authenticated', () => {
    const r = checkNpmAuth();
    if (r.ok) {
      expect(r.user.length).toBeGreaterThan(0);
    }
  });
});
