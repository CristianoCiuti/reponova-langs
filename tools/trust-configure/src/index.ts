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

/**
 * A single trust entry as returned by `npm trust list <pkg> --json` for the
 * `github` provider. The shape mirrors `lib/commands/trust/github.js`'s
 * `bodyToOptions` plus the `permissions` array that the trust-cmd layer
 * appends when serialising as JSON.
 */
export interface TrustEntry {
  readonly id?: string;
  readonly type?: string;
  readonly file?: string;
  readonly repository?: string;
  readonly environment?: string;
  readonly permissions?: readonly string[];
}

/**
 * Parses the stdout of `npm trust list <pkg> --json`.
 *
 * For a single trust the CLI prints one bare object; for multiple trusts it
 * prints them back-to-back (still as bare objects, not a JSON array — see
 * `displayResponseBody` in `lib/trust-cmd.js`). We accept both, plus any
 * leading/trailing blank lines, and gracefully degrade to `[]` on any
 * unparseable input.
 *
 * Exported so it can be unit-tested without touching the network.
 */
export function parseTrustListOutput(stdout: string): TrustEntry[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Multiple bare JSON objects concatenated. Insert commas between them
    // (`}\n{` -> `},\n{`) and wrap in `[ ... ]` to feed JSON.parse.
    try {
      const arrayLike = `[${trimmed.replace(/}\s*\n+\s*{/g, "},\n{")}]`;
      const parsed = JSON.parse(arrayLike);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }
}

/**
 * Returns true iff `entry` is the same trust we would create from
 * `(repo, workflow)` for the `github` provider.
 *
 * We don't compare the `permissions` array because the registry historically
 * served different presets (e.g. just `["createPackage"]` from CLI, or
 * `["createPackage", "createStagedPackage"]` from the legacy npmjs.com UI).
 * Both give CI the publish capability we need; matching only on provider +
 * repo + workflow keeps the check idempotent for any pre-existing config.
 *
 * Exported for unit tests.
 */
export function trustEntryMatches(
  entry: TrustEntry | null | undefined,
  repo: string,
  workflow: string,
): boolean {
  if (!entry) return false;
  return (
    entry.type === "github" &&
    entry.repository === repo &&
    entry.file === workflow
  );
}

/**
 * Reads the existing trust config for `pkgName` via `npm trust list`.
 *
 * BEST-EFFORT: the registry's `GET /-/package/<pkg>/trust` endpoint does
 * require OTP (verified empirically — both via `npm trust list` and via a
 * raw bearer-only HTTPS GET, both return 401). So this call only succeeds
 * when the user is inside a webauth cooldown. When it fails (EOTP, E401,
 * network, …) we silently fall back to `null` and let `configureTrust`
 * proceed; the canonical 409-Conflict idempotency path then handles
 * already-configured packages.
 */
function findExistingMatchingTrust(pkgName: string): TrustEntry | null {
  const r = spawnSync(
    "npm",
    ["trust", "list", pkgName, "--json"],
    { encoding: "utf8", shell: true },
  );
  if (r.status !== 0) return null;
  const entries = parseTrustListOutput(r.stdout ?? "");
  return entries.find((e) => trustEntryMatches(e, REPO, WORKFLOW)) ?? null;
}

/**
 * Detects npm's "trust already exists" 409 from stderr.
 *
 * `npm trust github` prints `npm error code E409` plus
 * `npm error 409 Conflict - POST .../trust`. We treat that as the canonical
 * "this trust already exists" signal and short-circuit to `skipped`.
 *
 * Exported for unit tests.
 */
export function looksLikeAlreadyConfigured(stderr: string): boolean {
  if (!stderr) return false;
  return (
    stderr.includes("npm error code E409") ||
    stderr.includes("code E409") ||
    /\b409 Conflict\b/.test(stderr)
  );
}

// On Windows, `npm` is `npm.cmd` (a batch file): Node's `spawnSync` cannot
// invoke it directly, so we always go through the shell. On POSIX `shell: true`
// is harmless. Same pattern as `tools/bootstrap-plugin/src/index.ts`.
function configureTrust(pkgName: string): "ok" | "skipped" | "failed" {
  // FAST-PATH idempotency check (best-effort): when the user is inside an
  // npm webauth cooldown, `npm trust list` succeeds without a fresh OTP
  // and lets us skip already-configured packages with zero security-key
  // taps. Outside the cooldown the call fails with EOTP and we fall
  // through to the canonical 409-Conflict path below.
  const existing = findExistingMatchingTrust(pkgName);
  if (existing) {
    console.log(
      `[trust-configure]   already configured (id=${existing.id ?? "?"}) — skipping`,
    );
    return "skipped";
  }

  const args = buildTrustArgs(pkgName);
  console.log(`[trust-configure] $ npm ${args.join(" ")}`);
  // stdin/stdout stay inherited so the user can see/operate the webauth
  // prompt; stderr is piped so we can pattern-match the 409 idempotency
  // signal afterwards. We always re-emit captured stderr verbatim so the
  // operator UX is unchanged.
  const r = spawnSync("npm", args, {
    stdio: ["inherit", "inherit", "pipe"],
    encoding: "utf8",
    shell: true,
  });
  if (r.stderr) {
    process.stderr.write(r.stderr);
  }
  if (r.status === 0) {
    console.log(`[trust-configure]   ok`);
    return "ok";
  }
  if (looksLikeAlreadyConfigured(r.stderr ?? "")) {
    console.log(
      `[trust-configure]   already configured (registry returned 409) — skipping`,
    );
    return "skipped";
  }
  console.error(`[trust-configure]   failed (exit ${r.status})`);
  return "failed";
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
  let skipped = 0;
  let failed = 0;
  for (let i = 0; i < pkgs.length; i++) {
    const pkg = pkgs[i]!;
    console.log(`[trust-configure] [${i + 1}/${pkgs.length}] ${pkg.name}`);
    const result = configureTrust(pkg.name);
    if (result === "ok") {
      ok++;
    } else if (result === "skipped") {
      skipped++;
    } else {
      failed++;
    }
    if (i < pkgs.length - 1) {
      // Brief delay between calls to stay below the npm registry rate limit.
      await sleep(2000);
    }
  }

  console.log("");
  console.log(
    `[trust-configure] done: ${ok} ok, ${skipped} already-configured (skipped), ${failed} failed`,
  );
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
