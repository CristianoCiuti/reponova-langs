/**
 * Regression tests for the idempotency check in trust-configure.
 *
 * Background: the original `trust-configure` always called
 * `npm trust github <pkg> ...`, even on packages whose trust was already
 * configured. The npm registry refuses a second creation of the same trust
 * with `409 Conflict`, so re-running the bulk apply blew up on every
 * already-configured package. The fix is a read-only pre-check via
 * `npm trust list <pkg> --json`: if a matching trust already exists, skip.
 *
 * These tests pin down both pieces of the pre-check:
 *   - `parseTrustListOutput`: tolerant of the `--json` output shapes the
 *     CLI produces (single bare object for one trust, multiple
 *     concatenated bare objects for several trusts), plus blank lines.
 *   - `trustEntryMatches`: matches only on provider + repo + workflow,
 *     **not** on the `permissions` set (the legacy UI provisions
 *     `[createPackage, createStagedPackage]` while `--allow-publish` only
 *     produces `[createPackage]`; both authorise the publish path we use).
 */
import { describe, expect, it } from 'vitest';
import {
  looksLikeAlreadyConfigured,
  parseTrustListOutput,
  trustEntryMatches,
} from '../src/index.js';

const SINGLE_OBJECT = `
{
  "id": "914cf52f-5e5e-4e1b-9b1a-b80e627f22b9",
  "type": "github",
  "file": "release.yml",
  "repository": "CristianoCiuti/reponova-langs",
  "permissions": ["createPackage"]
}
`;

// What the CLI prints when there are multiple trusted publishers on the
// same package: bare JSON objects back-to-back, separated by blank lines.
const MULTIPLE_OBJECTS = `
{
  "id": "first",
  "type": "github",
  "file": "release.yml",
  "repository": "CristianoCiuti/reponova-langs",
  "permissions": ["createPackage"]
}

{
  "id": "second",
  "type": "github",
  "file": "release.yml",
  "repository": "other/repo",
  "permissions": ["createPackage"]
}
`;

describe('parseTrustListOutput', () => {
  it('returns [] for empty / whitespace-only output', () => {
    expect(parseTrustListOutput('')).toEqual([]);
    expect(parseTrustListOutput('   \n\n')).toEqual([]);
  });

  it('parses a single bare JSON object as a one-element array', () => {
    const r = parseTrustListOutput(SINGLE_OBJECT);
    expect(r).toHaveLength(1);
    expect(r[0]?.id).toBe('914cf52f-5e5e-4e1b-9b1a-b80e627f22b9');
    expect(r[0]?.type).toBe('github');
    expect(r[0]?.repository).toBe('CristianoCiuti/reponova-langs');
    expect(r[0]?.file).toBe('release.yml');
  });

  it('parses multiple bare JSON objects concatenated by blank lines', () => {
    const r = parseTrustListOutput(MULTIPLE_OBJECTS);
    expect(r).toHaveLength(2);
    expect(r[0]?.id).toBe('first');
    expect(r[1]?.id).toBe('second');
    expect(r[1]?.repository).toBe('other/repo');
  });

  it('parses an explicit JSON array unchanged', () => {
    const arr = JSON.stringify([
      { id: 'a', type: 'github' },
      { id: 'b', type: 'github' },
    ]);
    const r = parseTrustListOutput(arr);
    expect(r.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('returns [] on unparseable garbage instead of throwing', () => {
    expect(parseTrustListOutput('this is not json {{{')).toEqual([]);
    expect(parseTrustListOutput('{ broken')).toEqual([]);
  });
});

describe('trustEntryMatches', () => {
  const REPO = 'CristianoCiuti/reponova-langs';
  const WF = 'release.yml';

  it('matches on provider + repo + workflow', () => {
    const entry = {
      id: 'x',
      type: 'github',
      file: 'release.yml',
      repository: 'CristianoCiuti/reponova-langs',
      permissions: ['createPackage'],
    };
    expect(trustEntryMatches(entry, REPO, WF)).toBe(true);
  });

  it('treats the legacy UI preset as a match (extra permissions ignored)', () => {
    // Existing packages provisioned via the npmjs.com UI have BOTH
    // permissions, while --allow-publish from the CLI only sets one.
    // Both authorise the publish flow we need, so we accept either.
    const entry = {
      id: 'x',
      type: 'github',
      file: 'release.yml',
      repository: 'CristianoCiuti/reponova-langs',
      permissions: ['createPackage', 'createStagedPackage'],
    };
    expect(trustEntryMatches(entry, REPO, WF)).toBe(true);
  });

  it('does not match when type is wrong (e.g. circleci)', () => {
    const entry = {
      id: 'x',
      type: 'circleci',
      file: 'release.yml',
      repository: 'CristianoCiuti/reponova-langs',
    };
    expect(trustEntryMatches(entry, REPO, WF)).toBe(false);
  });

  it('does not match when the repository differs', () => {
    const entry = {
      id: 'x',
      type: 'github',
      file: 'release.yml',
      repository: 'someoneelse/reponova-langs',
    };
    expect(trustEntryMatches(entry, REPO, WF)).toBe(false);
  });

  it('does not match when the workflow filename differs', () => {
    const entry = {
      id: 'x',
      type: 'github',
      file: 'publish.yml',
      repository: 'CristianoCiuti/reponova-langs',
    };
    expect(trustEntryMatches(entry, REPO, WF)).toBe(false);
  });

  it('returns false on null/undefined input (defensive)', () => {
    expect(trustEntryMatches(null, REPO, WF)).toBe(false);
    expect(trustEntryMatches(undefined, REPO, WF)).toBe(false);
  });
});

// Captured verbatim from a real `npm trust github ...` invocation against an
// already-configured package. The shape will not change without npm/cli
// shipping a stderr-format breaking change, in which case we want this test
// to fail loudly and force a re-evaluation.
const REAL_409_STDERR = `npm error code E409
npm error 409 Conflict - POST https://registry.npmjs.org/-/package/@reponova%2flang-plantuml/trust
npm error A complete log of this run can be found in: C:\\Users\\coii\\AppData\\Local\\npm-cache\\_logs\\2026-06-05T13_14_46_834Z-debug-0.log
`;

const REAL_400_STDERR = `npm error code E400
npm error 400 Bad Request - POST https://registry.npmjs.org/-/package/@reponova%2flang-typescript/trust
`;

describe('looksLikeAlreadyConfigured', () => {
  it('detects the canonical 409 stderr produced by `npm trust github`', () => {
    expect(looksLikeAlreadyConfigured(REAL_409_STDERR)).toBe(true);
  });

  it('does NOT match other npm error codes (regression: do not over-skip)', () => {
    // We must NOT silently skip on 400/401/etc — those are real failures
    // the operator needs to see and act on.
    expect(looksLikeAlreadyConfigured(REAL_400_STDERR)).toBe(false);
    expect(looksLikeAlreadyConfigured('npm error code E401\nnpm error 401 ...')).toBe(false);
    expect(looksLikeAlreadyConfigured('npm error code ENEEDAUTH')).toBe(false);
  });

  it('handles empty / undefined input defensively', () => {
    expect(looksLikeAlreadyConfigured('')).toBe(false);
    // @ts-expect-error testing defensive null
    expect(looksLikeAlreadyConfigured(null)).toBe(false);
    // @ts-expect-error testing defensive undefined
    expect(looksLikeAlreadyConfigured(undefined)).toBe(false);
  });

  it('matches the bare "409 Conflict" wording too (older npm releases)', () => {
    expect(looksLikeAlreadyConfigured('Some prefix\n409 Conflict\nsuffix')).toBe(true);
  });
});
