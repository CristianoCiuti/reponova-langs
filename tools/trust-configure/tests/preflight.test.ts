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
  it('reports a real semver-shaped version', () => {
    const r = checkNpmVersion();
    expect(r.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(r.version).not.toBe('<unknown>');
  });

  it('passes the >= 11.10 gate when running on a modern npm', () => {
    const r = checkNpmVersion();
    // The CI matrix and modern dev boxes ship npm >= 11.10.
    // If you intentionally test against an older npm, lower this expectation.
    expect(r.ok).toBe(true);
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
