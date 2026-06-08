#!/usr/bin/env node
/**
 * Guard that fails the build / release pipeline if a developer-only override
 * (`scripts/dev-link-reponova.mjs`) is still active in the working tree.
 *
 * Hooked into `prebuild`, `pretest`, and `prerelease` so CI never publishes
 * a tarball built against a local sibling checkout — and so a teammate
 * never accidentally commits the override.
 *
 * Two cheap checks:
 *   1. `package.json.pnpm.overrides.reponova` must NOT be set.
 *   2. The `.dev/` tarball directory must NOT exist.
 *
 * Either signal indicates `dev:link-reponova` is currently active.
 * Recovery: `pnpm dev:unlink-reponova`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_PATH = resolve(REPO_ROOT, "package.json");
const DEV_DIR = resolve(REPO_ROOT, ".dev");

const failures = [];

try {
  const pkg = JSON.parse(readFileSync(PKG_PATH, "utf-8"));
  const override = pkg?.pnpm?.overrides?.reponova;
  if (override) {
    failures.push(
      `package.json declares pnpm.overrides.reponova = "${override}" (developer-only).`,
    );
  }
} catch (err) {
  console.error(`[check:no-dev-link] cannot read ${PKG_PATH}: ${(err).message}`);
  process.exit(1);
}

if (existsSync(DEV_DIR)) {
  failures.push(`.dev/ directory exists (created by dev:link-reponova).`);
}

if (failures.length > 0) {
  console.error(`[check:no-dev-link] dev-link state detected — refusing to proceed:`);
  for (const msg of failures) console.error(`  • ${msg}`);
  console.error(`[check:no-dev-link] run \`pnpm dev:unlink-reponova\` to revert.`);
  process.exit(1);
}
