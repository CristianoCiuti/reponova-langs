#!/usr/bin/env node
/**
 * Cross-repo developer link for the sibling `reponova` checkout.
 *
 * Background
 * ----------
 * Plugins in this monorepo declare a dependency on the *published* `reponova`
 * npm package. While developing changes that touch BOTH `reponova` and a
 * `@reponova/lang-*` plugin simultaneously (e.g. a host-side API rename plus
 * the plugins updating their call sites), you need the plugins' build and
 * type-check to see the unreleased host code from `../reponova`.
 *
 * What this script does
 * ---------------------
 *  1. `npm pack` of `../reponova` → produces a tarball under `.dev/`.
 *  2. Writes `pnpm.overrides.reponova` in `package.json` pointing at that
 *     tarball — a self-contained, reproducible reference.
 *  3. Runs `pnpm install --no-frozen-lockfile` to apply the override.
 *
 * The resulting changes to `package.json` and `pnpm-lock.yaml` are
 * INTENTIONALLY LOCAL. Do NOT commit them — `scripts/check-no-dev-link.mjs`
 * is wired into `pretest`, `prebuild`, and `prerelease` to catch accidental
 * commits, and `pnpm dev:unlink-reponova` reverts every side-effect in one
 * command.
 *
 * Usage
 * -----
 *   pnpm dev:link-reponova                 # default: ../reponova
 *   REPONOVA_PATH=/path pnpm dev:link-reponova
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEV_DIR = resolve(REPO_ROOT, ".dev");
const PKG_PATH = resolve(REPO_ROOT, "package.json");

const reponovaPath = resolve(REPO_ROOT, process.env.REPONOVA_PATH ?? "../reponova");

if (!existsSync(resolve(reponovaPath, "package.json"))) {
  console.error(`[dev:link-reponova] not a reponova checkout: ${reponovaPath}`);
  console.error(`[dev:link-reponova] override REPONOVA_PATH to point at the sibling repo.`);
  process.exit(1);
}

// ─── 1. clean previous tarball(s) under .dev/ ────────────────────────────────
mkdirSync(DEV_DIR, { recursive: true });
for (const f of readdirSync(DEV_DIR)) {
  if (f.startsWith("reponova-") && f.endsWith(".tgz")) {
    unlinkSync(resolve(DEV_DIR, f));
  }
}

// ─── 2. npm pack ../reponova into .dev/ ──────────────────────────────────────
console.log(`[dev:link-reponova] packing ${reponovaPath} → ${relative(REPO_ROOT, DEV_DIR)}/`);
const pack = spawnSync(
  "npm",
  ["pack", "--pack-destination", DEV_DIR, "--silent"],
  { cwd: reponovaPath, encoding: "utf-8", shell: true, stdio: ["inherit", "pipe", "inherit"] },
);
if (pack.status !== 0) {
  console.error(`[dev:link-reponova] npm pack failed (exit ${pack.status})`);
  process.exit(pack.status ?? 1);
}
const tgz = readdirSync(DEV_DIR).find((f) => f.startsWith("reponova-") && f.endsWith(".tgz"));
if (!tgz) {
  console.error(`[dev:link-reponova] npm pack succeeded but produced no tarball — abort.`);
  process.exit(1);
}
const tgzRel = `file:./.dev/${tgz}`;
console.log(`[dev:link-reponova] tarball: ${tgz}`);

// ─── 3. write pnpm.overrides.reponova into package.json ──────────────────────
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf-8"));
pkg.pnpm = pkg.pnpm ?? {};
pkg.pnpm.overrides = pkg.pnpm.overrides ?? {};
pkg.pnpm.overrides.reponova = tgzRel;
writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
console.log(`[dev:link-reponova] package.json: pnpm.overrides.reponova = ${tgzRel}`);

// ─── 4. pnpm install with the new override ───────────────────────────────────
console.log(`[dev:link-reponova] $ pnpm install --no-frozen-lockfile`);
const inst = spawnSync(
  "pnpm",
  ["install", "--no-frozen-lockfile"],
  { cwd: REPO_ROOT, stdio: "inherit", shell: true },
);
if (inst.status !== 0) {
  console.error(`[dev:link-reponova] pnpm install failed (exit ${inst.status})`);
  process.exit(inst.status ?? 1);
}

console.log("");
console.log("[dev:link-reponova] ✓ linked to ../reponova");
console.log("[dev:link-reponova] REMEMBER: do not commit package.json or pnpm-lock.yaml in this state.");
console.log("[dev:link-reponova]          run `pnpm dev:unlink-reponova` to revert before committing.");
