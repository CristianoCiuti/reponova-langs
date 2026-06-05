/**
 * Unit tests for the shared `.github/scripts/retry.sh` retry / backoff
 * wrapper used by the Release workflow to absorb transient failures
 * (GitHub API 5xx, network resets) on idempotent network-bound steps.
 *
 * Tests run bash in a subprocess against a synthetic "mock command"
 * whose exit sequence is driven by a counter file, so the assertions
 * can verify the exact number of attempts retry made and the exit
 * code it propagated.
 *
 * The tests use INITIAL_BACKOFF=0 so the test suite stays fast; the
 * default 2s backoff is exercised manually in the smoke checks
 * documented in the PR description.
 */
import { describe, expect, it, beforeAll, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const RETRY_SCRIPT = resolve(HERE, '..', '..', '..', '.github', 'scripts', 'retry.sh');

/**
 * Bash from `git for windows` lives outside PATH on some Windows
 * dev boxes. spawnSync('bash', ...) uses whichever `bash` is on
 * PATH. On GitHub Actions runners (ubuntu / macos / windows-latest)
 * bash is always reachable, so we don't gate by platform.
 */
function bashAvailable(): boolean {
  const r = spawnSync('bash', ['--version'], { encoding: 'utf8', shell: false });
  return r.status === 0;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Invoke the retry.sh script directly, bypassing the source-and-call
 * pattern, by using `bash retry.sh -- <cmd...>`. Equivalent in effect
 * but easier to drive from a child process.
 */
function runRetry(opts: {
  maxAttempts: number;
  initialBackoff?: number;
  command: string;
  args: readonly string[];
}): RunResult {
  const env = {
    ...process.env,
    MAX_ATTEMPTS: String(opts.maxAttempts),
    INITIAL_BACKOFF: String(opts.initialBackoff ?? 0),
  };
  const r = spawnSync(
    'bash',
    [RETRY_SCRIPT, '--', opts.command, ...opts.args],
    { encoding: 'utf8', env, shell: false },
  );
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

let workdir: string;
let counterFile: string;
let mockScript: string;

function makeMockScript(failTimes: number, failExit = 1): void {
  // Mock command: increments the counter file and returns failExit
  // until the counter exceeds `failTimes`, then returns 0.
  const body = `#!/usr/bin/env bash
set -euo pipefail
counter_file="${counterFile.replace(/\\/g, '/')}"
if [[ ! -f "$counter_file" ]]; then echo 0 > "$counter_file"; fi
n=$(cat "$counter_file")
n=$((n + 1))
echo "$n" > "$counter_file"
if (( n <= ${failTimes} )); then
  echo "mock: attempt $n failing on purpose" >&2
  exit ${failExit}
fi
echo "mock: attempt $n succeeded"
exit 0
`;
  writeFileSync(mockScript, body, 'utf8');
  chmodSync(mockScript, 0o755);
}

function readCounter(): number {
  if (!existsSync(counterFile)) return 0;
  return Number(readFileSync(counterFile, 'utf8').trim());
}

beforeAll(() => {
  if (!bashAvailable()) {
    // The CI matrix on this repo always has bash. If a developer
    // runs the suite on a stripped-down Windows box without it, we
    // surface a clear message rather than failing each test.
    throw new Error(
      'retry.test.ts requires bash on PATH (Git Bash on Windows is fine). Skipped on this host.',
    );
  }
});

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'retry-test-'));
  counterFile = join(workdir, 'counter');
  mockScript = join(workdir, 'mock.sh');
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('retry.sh', () => {
  it('returns 0 immediately when the command succeeds on the first try', () => {
    makeMockScript(0);
    const r = runRetry({ maxAttempts: 5, command: 'bash', args: [mockScript] });
    expect(r.status).toBe(0);
    expect(readCounter()).toBe(1);
    expect(r.stderr).not.toContain('::warning::');
    expect(r.stderr).not.toContain('::error::');
    expect(r.stdout).toMatch(/attempt 1 succeeded/);
  });

  it('retries until success and returns 0 (success on the 3rd try)', () => {
    makeMockScript(2);
    const r = runRetry({ maxAttempts: 5, command: 'bash', args: [mockScript] });
    expect(r.status).toBe(0);
    expect(readCounter()).toBe(3);
    const warnings = (r.stderr.match(/::warning::Attempt /g) ?? []).length;
    expect(warnings).toBe(2);
    expect(r.stderr).not.toContain('::error::');
  });

  it('exhausts max attempts and propagates the original exit code', () => {
    makeMockScript(99, 7);
    const r = runRetry({ maxAttempts: 3, command: 'bash', args: [mockScript] });
    expect(r.status).toBe(7);
    expect(readCounter()).toBe(3);
    const warnings = (r.stderr.match(/::warning::Attempt /g) ?? []).length;
    expect(warnings).toBe(2);
    expect(r.stderr).toMatch(/::error::Command failed after 3 attempts \(exit 7\)/);
  });

  it('respects MAX_ATTEMPTS=1 (no retry, single shot)', () => {
    makeMockScript(99, 1);
    const r = runRetry({ maxAttempts: 1, command: 'bash', args: [mockScript] });
    expect(r.status).toBe(1);
    expect(readCounter()).toBe(1);
    expect(r.stderr).not.toContain('::warning::');
    expect(r.stderr).toMatch(/::error::Command failed after 1 attempts/);
  });

  it('exits 2 when called with no command', () => {
    const env = { ...process.env, MAX_ATTEMPTS: '3', INITIAL_BACKOFF: '0' };
    const r = spawnSync('bash', [RETRY_SCRIPT, '--'], {
      encoding: 'utf8',
      env,
      shell: false,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/missing command/);
  });

  it('rejects MAX_ATTEMPTS < 1', () => {
    const env = { ...process.env, MAX_ATTEMPTS: '0', INITIAL_BACKOFF: '0' };
    const r = spawnSync('bash', [RETRY_SCRIPT, '--', 'true'], {
      encoding: 'utf8',
      env,
      shell: false,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/MAX_ATTEMPTS must be >= 1/);
  });

  it('accepts positional overrides: `retry 3 0 -- cmd`', () => {
    makeMockScript(99, 5);
    const r = spawnSync(
      'bash',
      [RETRY_SCRIPT, '3', '0', '--', 'bash', mockScript],
      { encoding: 'utf8', env: { ...process.env }, shell: false },
    );
    expect(r.status).toBe(5);
    expect(readCounter()).toBe(3);
  });

  it('preserves exit code from a deeply nested command (bash -c)', () => {
    const r = spawnSync(
      'bash',
      [RETRY_SCRIPT, '--', 'bash', '-c', 'exit 42'],
      {
        encoding: 'utf8',
        env: { ...process.env, MAX_ATTEMPTS: '2', INITIAL_BACKOFF: '0' },
        shell: false,
      },
    );
    expect(r.status).toBe(42);
    expect(r.stderr).toMatch(/exit 42/);
  });
});

describe('retry.sh — sourced helper form', () => {
  it('works when sourced and used as `retry -- cmd ...`', () => {
    makeMockScript(1);
    const r = spawnSync(
      'bash',
      [
        '-c',
        `source "${RETRY_SCRIPT.replace(/\\/g, '/')}" && retry -- bash "${mockScript.replace(/\\/g, '/')}"`,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, MAX_ATTEMPTS: '5', INITIAL_BACKOFF: '0' },
        shell: false,
      },
    );
    expect(r.status).toBe(0);
    expect(readCounter()).toBe(2);
  });
});
