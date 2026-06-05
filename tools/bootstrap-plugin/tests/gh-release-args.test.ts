/**
 * Regression test for `gh release create` argument construction.
 *
 * The bootstrap-plugin previously built `gh release create ... --notes
 * "<inline markdown>"` and ran it with `shell: true`. This blew up at
 * runtime as soon as a CHANGELOG section contained shell-special
 * characters that the parent shell (zsh on the maintainer's box) tried
 * to interpret. Concretely we hit:
 *
 *     no matches found for `Minor`
 *     [bootstrap-plugin] gh release create failed (exit 1)
 *
 * because zsh's `nomatch` saw markdown like
 * `### Minor Changes\n- [\`abc1234\`](url)` and bailed out before `gh`
 * even started.
 *
 * Fix: pass the body via `--notes-file <tmp>` (or, when there is no
 * matching CHANGELOG section, fall back to GitHub's
 * `--generate-notes`). A file path is opaque to the shell, so the
 * content survives verbatim regardless of what's inside.
 *
 * These tests pin down the canonical argv shapes and explicitly assert
 * that the inline `--notes` form is NEVER produced again.
 */
import { describe, expect, it } from 'vitest';
import { buildGhReleaseArgs } from '../src/index.js';

const TAG = '@reponova/lang-typescript@0.1.0';

describe('buildGhReleaseArgs', () => {
  it('emits the canonical "release create <tag> --title <tag> ..." preamble', () => {
    const args = buildGhReleaseArgs(TAG, { generateNotes: true });
    expect(args[0]).toBe('release');
    expect(args[1]).toBe('create');
    expect(args[2]).toBe(TAG);
    expect(args.slice(3, 5)).toEqual(['--title', TAG]);
  });

  it('uses --notes-file when a body file is provided', () => {
    const args = buildGhReleaseArgs(TAG, {
      notesFile: '/tmp/reponova-bootstrap-abc/release-notes.md',
    });
    const idx = args.indexOf('--notes-file');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe(
      '/tmp/reponova-bootstrap-abc/release-notes.md',
    );
  });

  it('falls back to --generate-notes when CHANGELOG is missing', () => {
    const args = buildGhReleaseArgs(TAG, { generateNotes: true });
    expect(args).toContain('--generate-notes');
    expect(args).not.toContain('--notes-file');
  });

  it('never emits the inline --notes form (regression: shell-expansion bomb)', () => {
    // Both branches must avoid `--notes <inline>`. The historical bug
    // was specifically `gh release create ... --notes "<markdown>"`,
    // which under `shell: true` let zsh / bash interpret backticks and
    // brackets inside the markdown.
    expect(buildGhReleaseArgs(TAG, { notesFile: '/tmp/x.md' })).not.toContain('--notes');
    expect(buildGhReleaseArgs(TAG, { generateNotes: true })).not.toContain('--notes');
  });

  it('does not duplicate the body source (mutually exclusive options)', () => {
    const a = buildGhReleaseArgs(TAG, { notesFile: '/tmp/x.md' });
    expect(a.includes('--notes-file') && a.includes('--generate-notes')).toBe(false);
    const b = buildGhReleaseArgs(TAG, { generateNotes: true });
    expect(b.includes('--notes-file') && b.includes('--generate-notes')).toBe(false);
  });
});
