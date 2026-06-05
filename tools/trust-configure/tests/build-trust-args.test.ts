/**
 * Regression test for the trust-configure command builder.
 *
 * We were once shipping `npm trust github ... --allow-publish --yes`. That
 * flag does not exist in any released npm CLI: the operator-provided list of
 * accepted flags for `npm trust github` is fixed by the npm CLI itself
 * (see `npm trust github --help` on npm >= 11.10), and trying to pass an
 * unknown flag makes npm refuse the entire command with EUSAGE. The bug went
 * undetected because the very first `pnpm bootstrap-plugin lang-<id>` flow
 * had to wait for an npm package to actually exist on the registry before
 * `npm trust github` could be invoked at all.
 *
 * This test pins down `buildTrustArgs` to ONLY emit flags that npm actually
 * documents. Any future drift (someone re-introducing `--allow-publish` or
 * inventing a new flag) will fail this test before it ever reaches a user.
 */
import { describe, expect, it } from 'vitest';
import { buildTrustArgs } from '../src/index.js';

// The full accepted flag set documented by `npm trust github --help`
// (npm CLI 11.10+). Keep this list in sync with the npm docs; it is small
// enough to be exhaustive on purpose.
const ALLOWED_FLAGS = new Set([
  '--file',
  '--repository',
  '--repo',
  '--environment',
  '--env',
  '--dry-run',
  '--json',
  '--registry',
  '-y',
  '--yes',
]);

describe('buildTrustArgs', () => {
  it('starts with the canonical "trust github <pkg>" preamble', () => {
    const args = buildTrustArgs('@reponova/lang-typescript');
    expect(args[0]).toBe('trust');
    expect(args[1]).toBe('github');
    expect(args[2]).toBe('@reponova/lang-typescript');
  });

  it('emits --file (required by npm) and --repo with the configured repo', () => {
    const args = buildTrustArgs('@reponova/lang-typescript', 'octo/repo', 'release.yml');
    const repoIdx = args.indexOf('--repo');
    const fileIdx = args.indexOf('--file');
    expect(repoIdx).toBeGreaterThanOrEqual(0);
    expect(fileIdx).toBeGreaterThanOrEqual(0);
    expect(args[repoIdx + 1]).toBe('octo/repo');
    expect(args[fileIdx + 1]).toBe('release.yml');
  });

  it('non-interactive: passes --yes', () => {
    const args = buildTrustArgs('@reponova/lang-typescript');
    expect(args).toContain('--yes');
  });

  it('does NOT pass any flag outside the documented npm allowlist', () => {
    const args = buildTrustArgs('@reponova/lang-typescript');
    const flags = args.filter((a) => a.startsWith('-'));
    for (const f of flags) {
      expect(ALLOWED_FLAGS, `flag ${f} is not accepted by 'npm trust github'`).toContain(f);
    }
  });

  it('explicitly rejects the historical --allow-publish bug', () => {
    // This is a paranoia assertion against the specific regression we hit.
    // Trust-publishing is the entire point of the relationship; there is no
    // separate permission flag in npm.
    const args = buildTrustArgs('@reponova/lang-typescript');
    expect(args).not.toContain('--allow-publish');
  });
});
