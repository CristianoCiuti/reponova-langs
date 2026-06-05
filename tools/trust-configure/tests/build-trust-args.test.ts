/**
 * Regression test for the trust-configure command builder.
 *
 * Pins down `buildTrustArgs` to the documented `npm trust github` flag set
 * for npm CLI >= 11.15 (the version that introduced `--allow-publish` /
 * `--allow-stage-publish` and started populating the `permissions` field
 * required by the registry — see npm/cli#9248 + #9376, released 2026-05-20).
 *
 * Two regressions we have already hit and want to keep nailed down:
 *
 * 1. **Without `--allow-publish`**: the registry rejects POST .../trust
 *    with `400 "permissions is required and must contain at least one valid
 *    route"`. We confirmed this with a manual replay of the exact CLI
 *    payload (npm/cli#9377 means the CLI does not surface that body, so we
 *    captured it via `scripts/diagnose-trust.mjs` before deleting it).
 *
 * 2. **With unknown flags**: any flag outside the documented allowlist
 *    makes npm refuse the command with `EUSAGE Unknown flag: ...`. This
 *    happened the very first time we exercised the flow on npm 11.12.1
 *    (which did not yet know `--allow-publish`), and pushed us — wrongly —
 *    to remove the flag entirely. The fix is npm >= 11.15, not flag removal.
 *
 * Together these tests make sure we always pass the canonical flag set.
 */
import { describe, expect, it } from 'vitest';
import { buildTrustArgs } from '../src/index.js';

// Full accepted flag set documented in `npm trust github --help` for
// npm CLI 11.15+. Kept exhaustive on purpose so future drift is caught.
const ALLOWED_FLAGS = new Set([
  '--file',
  '--repository',
  '--repo',
  '--environment',
  '--env',
  '--allow-publish',
  '--allow-stage-publish',
  '--allow-staged-publish',
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

  it('passes --allow-publish (required by the registry since 2026-05-20)', () => {
    // Without this flag, npm CLI >= 11.15 sends an empty `permissions`
    // array and the registry replies 400 "permissions is required and
    // must contain at least one valid route". This is exactly the bug
    // that broke `pnpm bootstrap-plugin lang-typescript --yes`.
    const args = buildTrustArgs('@reponova/lang-typescript');
    expect(args).toContain('--allow-publish');
  });

  it('does NOT pass any flag outside the documented npm allowlist', () => {
    const args = buildTrustArgs('@reponova/lang-typescript');
    const flags = args.filter((a) => a.startsWith('-'));
    for (const f of flags) {
      expect(ALLOWED_FLAGS, `flag ${f} is not accepted by 'npm trust github'`).toContain(f);
    }
  });
});
