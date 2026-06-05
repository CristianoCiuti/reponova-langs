/**
 * Pre-flight checks (npm version + npm auth) for the trust-configure CLI.
 *
 * Extracted from `index.ts` so the regression test in `tests/preflight.test.ts`
 * can import the helpers directly without triggering `main()`'s side effects.
 *
 * On Windows, `npm` is `npm.cmd` (a batch file) and Node's `spawnSync` cannot
 * invoke it directly. Both helpers therefore use `shell: true`, which is also
 * harmless on POSIX. This is the exact regression we caught the hard way: the
 * previous version omitted `shell: true` and reported `version: "<unknown>"`
 * on Windows even when npm was correctly installed and on PATH, blocking
 * `pnpm bootstrap-plugin lang-<id>` mid-flow on the trust step.
 */
import { spawnSync } from "node:child_process";

export interface NpmVersionResult {
  readonly ok: boolean;
  readonly version: string;
}

/**
 * Returns the running npm CLI version, gating on `>= 11.10` (required by the
 * `npm trust` subcommand). Uses `shell: true` so it works on Windows.
 */
export function checkNpmVersion(): NpmVersionResult {
  const r = spawnSync("npm", ["--version"], { encoding: "utf8", shell: true });
  if (r.status !== 0) {
    return { ok: false, version: "<unknown>" };
  }
  const version = r.stdout.trim();
  const [major, minor] = version.split(".").map((n) => Number(n));
  if (typeof major !== "number" || Number.isNaN(major)) {
    return { ok: false, version };
  }
  if (major > 11) return { ok: true, version };
  if (major === 11 && (minor ?? 0) >= 10) return { ok: true, version };
  return { ok: false, version };
}

export interface NpmAuthResult {
  readonly ok: boolean;
  readonly user: string;
}

/** Returns the npm-authenticated user, or `ok: false` if not logged in. */
export function checkNpmAuth(): NpmAuthResult {
  const r = spawnSync("npm", ["whoami"], { encoding: "utf8", shell: true });
  if (r.status !== 0) {
    return { ok: false, user: "" };
  }
  return { ok: true, user: r.stdout.trim() };
}
