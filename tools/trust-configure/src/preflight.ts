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
 * Minimum npm CLI required by `trust-configure`.
 *
 * - 11.10 introduced the `npm trust` subcommand itself.
 * - 11.15 added the `--allow-publish` / `--allow-stage-publish` flags
 *   (npm/cli#9248, backported as #9376) and started populating the new
 *   `permissions` field in the registry payload. Since 2026-05-20 the
 *   registry **requires** `permissions` and rejects POST .../trust with
 *   `400 "permissions is required and must contain at least one valid route"`
 *   when called without it. So 11.15 is the first version that actually
 *   works end-to-end against the live registry.
 */
export const MIN_NPM_MAJOR = 11;
export const MIN_NPM_MINOR = 15;

/**
 * Returns the running npm CLI version, gating on the minimum that produces
 * a valid `npm trust github` payload (see `MIN_NPM_*`). Uses `shell: true`
 * so it works on Windows, where `npm` is `npm.cmd`.
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
  if (major > MIN_NPM_MAJOR) return { ok: true, version };
  if (major === MIN_NPM_MAJOR && (minor ?? 0) >= MIN_NPM_MINOR) {
    return { ok: true, version };
  }
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
