/**
 * Trust-configure CLI.
 *
 * Discovers every published `@reponova/lang-*` package in the workspace and
 * runs `npm trust github` against each of them to register the GitHub Actions
 * OIDC trusted publisher (CristianoCiuti/reponova-langs + release.yml).
 *
 * Why not configure the scope once on npmjs.com? npm has no scope-level
 * Trusted Publisher (https://github.com/npm/cli/issues/8877). Each package is
 * configured individually. This script is the simplest "one-shot bulk" for the
 * monorepo and is idempotent (running it again on already-configured packages
 * is a no-op or a re-confirmation).
 *
 * Usage:
 *   pnpm trust:configure              # dry-run: list packages, show commands
 *   pnpm trust:configure --apply      # actually run npm trust github for each
 *
 * Prerequisites for --apply:
 *   - npm CLI >= 11.15.0 — required because the registry now mandates the
 *     `permissions` field in the trust payload (added in npm/cli#9248,
 *     released in 11.15) and rejects older payloads with
 *     `400 "permissions is required and must contain at least one valid route"`
 *   - Logged in: `npm login` (interactive)
 *   - 2FA in "auth-and-writes" mode (the trust API ignores classic OTP
 *     bypasses and forces a fresh webauth handshake on every call)
 *   - The package must already exist on npm (first publish must be a manual
 *     `npm publish` with OTP, or via the npm UI's Trusted Publisher setup)
 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { checkNpmAuth, checkNpmVersion } from "./preflight.js";

const REPO = "CristianoCiuti/reponova-langs";
const WORKFLOW = "release.yml";
const SCOPE_PREFIX = "@reponova/lang-";

interface PackageJson {
  readonly name?: string;
  readonly private?: boolean;
}

interface DiscoveredPackage {
  readonly name: string;
  readonly path: string;
}

interface CliOptions {
  readonly apply: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let apply = false;
  for (const arg of argv) {
    if (arg === "--" || arg === "") continue;
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`[trust-configure] unknown argument: ${arg}`);
      printHelp();
      process.exit(2);
    }
  }
  return { apply };
}

function printHelp(): void {
  console.log(`Usage: trust-configure [options]

Options:
  --apply       Actually run \`npm trust github\` for each package.
                Without this flag the script is a dry-run.
  -h, --help    Show this help.

Discovers every non-private @reponova/lang-* package in packages/, then
configures the GitHub Actions OIDC trusted publisher on npmjs.com for each.

Prerequisites for --apply:
  - npm CLI >= 11.15.0 (required by the registry's \`permissions\` field)
  - Logged in: \`npm login\`
  - 2FA in "auth-and-writes" mode (every trust call triggers a fresh
    webauth handshake regardless of OTP bypass settings)
  - Each package must already exist on npm (first publish must be manual)`);
}

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/index.ts -> ../../../ = monorepo root
  return join(here, "..", "..", "..");
}

async function discoverPackages(root: string): Promise<DiscoveredPackage[]> {
  const packagesDir = join(root, "packages");
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const out: DiscoveredPackage[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const pjPath = join(packagesDir, e.name, "package.json");
    let raw: string;
    try {
      raw = await readFile(pjPath, "utf8");
    } catch {
      continue;
    }
    let pj: PackageJson;
    try {
      pj = JSON.parse(raw) as PackageJson;
    } catch {
      console.warn(`[trust-configure] skipping ${pjPath} (not valid JSON)`);
      continue;
    }
    if (pj.private) continue;
    if (!pj.name || !pj.name.startsWith(SCOPE_PREFIX)) continue;
    out.push({ name: pj.name, path: join(packagesDir, e.name) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Build the argv for `npm trust github`. Pure function so it can be
 * unit-tested against the flag allowlist documented in `npm trust github
 * --help` (npm CLI >= 11.15).
 *
 * IMPORTANT — do not invent flags here. The accepted set, verbatim:
 *   --file (required), --repository|--repo, --environment|--env,
 *   --allow-publish, --allow-stage-publish (alias --allow-staged-publish),
 *   --dry-run, --json, --registry, -y|--yes
 *
 * `--allow-publish` is REQUIRED in practice: since 2026-05-20 the registry
 * refuses POST .../trust without a `permissions` entry, and the only
 * permission we want for OIDC release publishes is "create package"
 * (i.e. `--allow-publish`). Without it the registry returns
 * `400 Bad Request - "permissions is required and must contain at least
 * one valid route"`.
 */
export function buildTrustArgs(
  pkgName: string,
  repo: string = REPO,
  workflow: string = WORKFLOW,
): readonly string[] {
  return [
    "trust",
    "github",
    pkgName,
    "--repo",
    repo,
    "--file",
    workflow,
    "--allow-publish",
    "--yes",
  ];
}

// On Windows, `npm` is `npm.cmd` (a batch file): Node's `spawnSync` cannot
// invoke it directly, so we always go through the shell. On POSIX `shell: true`
// is harmless. Same pattern as `tools/bootstrap-plugin/src/index.ts`.
function configureTrust(pkgName: string): boolean {
  const args = buildTrustArgs(pkgName);
  console.log(`[trust-configure] $ npm ${args.join(" ")}`);
  const r = spawnSync("npm", args, { stdio: "inherit", shell: true });
  if (r.status === 0) {
    console.log(`[trust-configure]   ok`);
    return true;
  }
  console.error(`[trust-configure]   failed (exit ${r.status})`);
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const root = repoRoot();

  console.log(`[trust-configure] mode: ${opts.apply ? "APPLY" : "dry-run (no writes)"}`);
  console.log(`[trust-configure] repo: ${REPO}`);
  console.log(`[trust-configure] workflow: ${WORKFLOW}`);
  console.log(`[trust-configure] scope:    ${SCOPE_PREFIX}*`);
  console.log("");

  const pkgs = await discoverPackages(root);
  if (pkgs.length === 0) {
    console.log(`[trust-configure] no published @reponova/lang-* packages discovered`);
    return;
  }

  console.log(`[trust-configure] discovered ${pkgs.length} package(s):`);
  for (const p of pkgs) {
    console.log(`[trust-configure]   - ${p.name}`);
  }
  console.log("");

  if (!opts.apply) {
    console.log(`[trust-configure] dry-run. Re-run with --apply to configure.`);
    console.log(`[trust-configure] Equivalent commands that would run:`);
    for (const p of pkgs) {
      console.log(`[trust-configure]   npm ${buildTrustArgs(p.name).join(" ")}`);
    }
    return;
  }

  const npmVer = checkNpmVersion();
  if (!npmVer.ok) {
    console.error(
      `[trust-configure] npm >= 11.15.0 is required (got ${npmVer.version}).`,
    );
    console.error(
      `[trust-configure] 11.15 added the --allow-publish flag and the `,
    );
    console.error(
      `[trust-configure] 'permissions' field that the registry now requires;`,
    );
    console.error(
      `[trust-configure] older versions get 400 "permissions is required ...".`,
    );
    console.error(`[trust-configure] run: npm install -g npm@latest`);
    process.exit(1);
  }
  console.log(`[trust-configure] npm version: ${npmVer.version} (ok)`);

  const auth = checkNpmAuth();
  if (!auth.ok) {
    console.error(`[trust-configure] not authenticated. run: npm login`);
    process.exit(1);
  }
  console.log(`[trust-configure] npm user: ${auth.user}`);
  console.log("");

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < pkgs.length; i++) {
    const pkg = pkgs[i]!;
    console.log(`[trust-configure] [${i + 1}/${pkgs.length}] ${pkg.name}`);
    const success = configureTrust(pkg.name);
    if (success) {
      ok++;
    } else {
      failed++;
    }
    if (i < pkgs.length - 1) {
      // Brief delay between calls to stay below the npm registry rate limit.
      await sleep(2000);
    }
  }

  console.log("");
  console.log(`[trust-configure] done: ${ok} ok, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

// Only run when invoked as the entry point (i.e. `tsx src/index.ts ...`),
// NOT when imported by Vitest. Without this guard, importing this module
// from a test file would run the full CLI as a side effect.
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch((err) => {
    console.error((err as Error).stack ?? String(err));
    process.exit(1);
  });
}
