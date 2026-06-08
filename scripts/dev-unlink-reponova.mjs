#!/usr/bin/env node
/**
 * Reverts everything `scripts/dev-link-reponova.mjs` did, surgically — i.e.
 * WITHOUT a brute `git checkout package.json`, which would clobber any
 * unrelated edits the developer might have in flight (new npm scripts,
 * dependency bumps, etc.).
 *
 * Steps:
 *  1. Read `package.json`, delete `pnpm.overrides.reponova`. If
 *     `pnpm.overrides` becomes empty, drop it. If `pnpm` becomes empty,
 *     drop it too. The rest of the file is untouched.
 *  2. Delete the `.dev/` tarball directory.
 *  3. `pnpm install --frozen-lockfile` — restore node_modules to the
 *     committed lockfile state.
 *
 * Transitional caveat — pre-publish window
 * ----------------------------------------
 * When a feature spans `reponova` AND this monorepo, the plugins'
 * `package.json` may already declare a `peerDependencies.reponova` range
 * that doesn't exist on npm yet (e.g. `^0.5.0` while the published version
 * is still `0.4.3`). The committed `pnpm-lock.yaml` then necessarily lags
 * behind the package.json, and `pnpm install --frozen-lockfile` exits with
 * `ERR_PNPM_OUTDATED_LOCKFILE`.
 *
 * This is **expected and benign** for the duration of the cross-repo
 * release: the lockfile gets re-resolved once `reponova` ships the new
 * version to npm. In that case we log a friendly note and exit 0 — the
 * working tree is already clean (step 1 succeeded), so the developer can
 * commit a coordinated PR pair.
 *
 * Safe to call when no link is active — step 1 becomes a no-op if the
 * override isn't there, and `.dev/` is removed only if it exists.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_PATH = resolve(REPO_ROOT, "package.json");
const DEV_DIR = resolve(REPO_ROOT, ".dev");

// ─── 1. surgical removal of pnpm.overrides.reponova ──────────────────────────
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf-8"));
let changed = false;
if (pkg?.pnpm?.overrides && Object.prototype.hasOwnProperty.call(pkg.pnpm.overrides, "reponova")) {
  delete pkg.pnpm.overrides.reponova;
  changed = true;
  if (Object.keys(pkg.pnpm.overrides).length === 0) {
    delete pkg.pnpm.overrides;
  }
  if (pkg.pnpm && Object.keys(pkg.pnpm).length === 0) {
    delete pkg.pnpm;
  }
}
if (changed) {
  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  console.log(`[dev:unlink-reponova] package.json: removed pnpm.overrides.reponova`);
} else {
  console.log(`[dev:unlink-reponova] package.json: no override to remove (already unlinked)`);
}

// ─── 2. remove .dev/ ─────────────────────────────────────────────────────────
if (existsSync(DEV_DIR)) {
  console.log(`[dev:unlink-reponova] removing .dev/`);
  rmSync(DEV_DIR, { recursive: true, force: true });
}

// ─── 3. restore the committed pnpm-lock.yaml ─────────────────────────────────
// The lockfile is never edited by hand — it's purely the output of
// `pnpm install`. Reverting it from git is safe and the cheapest way to
// drop the `file:./.dev/reponova-*.tgz` entries the link injected.
console.log(`[dev:unlink-reponova] $ git checkout -- pnpm-lock.yaml`);
const gco = spawnSync(
  "git",
  ["checkout", "--", "pnpm-lock.yaml"],
  { cwd: REPO_ROOT, stdio: "inherit", shell: true },
);
if (gco.status !== 0) {
  console.error(`[dev:unlink-reponova] git checkout failed (exit ${gco.status})`);
  process.exit(gco.status ?? 1);
}

// ─── 4. reinstall to sync node_modules with the committed lockfile ───────────
console.log(`[dev:unlink-reponova] $ pnpm install --frozen-lockfile`);
const inst = spawnSync(
  "pnpm",
  ["install", "--frozen-lockfile"],
  { cwd: REPO_ROOT, stdio: ["inherit", "pipe", "pipe"], shell: true, encoding: "utf-8" },
);
// pnpm on Windows can route ERR_PNPM_* messages to either stream depending on
// shell layering, so we capture both and inspect the union.
const stdout = inst.stdout ?? "";
const stderr = inst.stderr ?? "";
process.stdout.write(stdout);
process.stderr.write(stderr);
const combined = `${stdout}\n${stderr}`;

if (inst.status === 0) {
  console.log("");
  console.log("[dev:unlink-reponova] ✓ workspace restored to the lockfile-pinned reponova version");
  process.exit(0);
}

if (/ERR_PNPM_OUTDATED_LOCKFILE/.test(combined)) {
  console.log("");
  console.log("[dev:unlink-reponova] ✓ override removed; .dev/ cleaned.");
  console.log("[dev:unlink-reponova] note: the lockfile is out of sync with package.json — this");
  console.log("[dev:unlink-reponova]       is EXPECTED while reponova's next version isn't on npm");
  console.log("[dev:unlink-reponova]       yet. The working tree is clean and safe to commit. When");
  console.log("[dev:unlink-reponova]       the upstream release ships, run `pnpm install` to");
  console.log("[dev:unlink-reponova]       regenerate the lockfile.");
  process.exit(0);
}

console.error(`[dev:unlink-reponova] pnpm install failed (exit ${inst.status})`);
process.exit(inst.status ?? 1);
