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
 *
 * Why a real PTY (`node-pty`) instead of `child_process.spawn`?
 *
 * `npm trust github` performs a webauth-style 2FA challenge that requires a
 * real TTY on stdin/stdout. The previous implementation used
 * `child_process.spawnSync('npm', ..., { stdio: ['inherit','inherit','pipe'],
 * shell: true })`, which on Windows interposes `cmd.exe /c npm.cmd ...` and
 * pipes stderr to a non-TTY pipe. That combination crashed the npm CLI's
 * webauth handler with `STATUS_STACK_BUFFER_OVERRUN` (exit code 3221226505 =
 * 0xC0000409) the moment the registry demanded a fresh OTP, leaving the
 * monorepo's first-publish flow stuck.
 *
 * This implementation routes the npm process through a `node-pty` PTY:
 *   - Windows uses ConPTY (Windows >= 10 1809), prebuilt and shipped with
 *     `node-pty`.
 *   - POSIX uses pty.h.
 * Both surfaces give the npm CLI a genuine TTY to talk to, so webauth's
 * `isatty()` checks succeed and the 2FA handshake completes. We forward
 * stdin (in raw mode), stdout, terminal resize, and SIGINT between the
 * parent terminal and the PTY for full interactive parity.
 *
 * The fast-path read (`npm trust list --json`) keeps using plain
 * `child_process.spawnSync` because it is non-interactive and either succeeds
 * (operator inside the webauth cooldown) or fails silently (we then proceed
 * to the write path).
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
  - Each package must already exist on npm (first publish must be manual)
  - An interactive terminal (a real TTY); the script pipes stdin/stdout to
    a node-pty pseudo-terminal so the npm webauth prompt can read your OTP.`);
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
 * network, …) we silently fall back to `null` and let the caller proceed
 * to either the write path (interactive, with PTY) or the post-mortem
 * idempotency check.
 *
 * Non-interactive: this is just a read, no TTY required.
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
 * "this trust already exists" signal.
 *
 * The PTY-based code path replaces direct stderr-pattern-matching with a
 * post-mortem `npm trust list` read, which is more robust (the npm CLI may
 * change error wording across versions). This helper is kept exported for
 * downstream consumers and for future reintroduction if needed.
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

/**
 * Returns true iff stdin AND stdout both look like a real TTY. The npm CLI's
 * webauth handler checks `process.stdout.isTTY` to decide whether to pop a
 * webauth prompt vs return EOTP; if stdin is also a TTY it then expects to
 * read the OTP back. Without both, the webauth handshake fails (or, on
 * Windows, crashes with STATUS_STACK_BUFFER_OVERRUN).
 *
 * Exported for unit testability.
 */
export function isInteractiveTty(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * Spawns `npm <args>` inside a PTY (via `node-pty`) and forwards stdin/stdout/
 * resize/SIGINT between the parent terminal and the child. Returns the exit
 * code emitted by the PTY when the child terminates.
 *
 * The PTY allocation is deferred to call time (and the import is dynamic) so
 * tests that never enter the write path don't pay the native-binding load.
 *
 * Process-termination contract (the reason this function is exported):
 *
 * After `onExit` fires we MUST release every async resource that would
 * otherwise keep the parent Node event loop alive past the awaited
 * `Promise<{ exitCode }>`. The hangs the previous version produced were
 * traced to two leaks:
 *
 *   1. `node-pty` keeps the ConPTY agent / pty.h side resources alive
 *      after the child exits unless `pty.kill()` is called explicitly.
 *      The native binding registers libuv handles that hold the loop
 *      open. `pty.kill()` is idempotent and a no-op on a child that has
 *      already exited.
 *
 *   2. `process.stdin.resume()` on a TTY auto-reffs the stdin file
 *      descriptor; `pause()` STOPS reading but does NOT unref. With the
 *      fd still ref'd, the loop stays alive forever even after the
 *      promise has resolved. `process.stdin.unref()` is the documented
 *      way out (see Node.js docs, "Process I/O").
 *
 * Both fixes ship behind narrow try/catch blocks: on a stdin that's
 * already been destroyed, both `setRawMode` and `unref` can throw, and
 * since the child is already gone we'd rather move on than crash a
 * recovery script.
 *
 * Exported for the smoke test in `tests/pty-cleanup.test.ts` which spawns
 * a child Node, calls this directly with a fast-completing argv (e.g.
 * `["--version"]`), and asserts that the child terminates within a
 * bounded wall-clock window — the only deterministic regression test
 * possible for "did the event loop drain?".
 */
export async function spawnNpmViaPty(
  args: readonly string[],
): Promise<{ exitCode: number | null }> {
  const { spawn: ptySpawn } = await import("node-pty");
  const npmExe = process.platform === "win32" ? "npm.cmd" : "npm";
  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;

  const pty = ptySpawn(npmExe, [...args], {
    name: "xterm-color",
    cols,
    rows,
    cwd: process.cwd(),
    env: process.env as Record<string, string | undefined>,
  });

  return new Promise<{ exitCode: number | null }>((resolve) => {
    const dataDisposable = pty.onData((data) => {
      process.stdout.write(data);
    });

    const onStdin = (chunk: Buffer): void => {
      pty.write(chunk.toString("utf8"));
    };

    const wasRaw = process.stdin.isRaw === true;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", onStdin);
    }

    const onResize = (): void => {
      const newCols = process.stdout.columns ?? cols;
      const newRows = process.stdout.rows ?? rows;
      try {
        pty.resize(newCols, newRows);
      } catch {
        // pty may have just exited; ignore.
      }
    };
    process.stdout.on("resize", onResize);

    const onSigint = (): void => {
      try {
        // node-pty on Windows refuses non-default signals; fall back to
        // the bare kill() (SIGHUP-equivalent) which closes the ConPTY.
        if (process.platform === "win32") {
          pty.kill();
        } else {
          pty.kill("SIGINT");
        }
      } catch {
        // ignore
      }
    };
    process.on("SIGINT", onSigint);

    const exitDisposable = pty.onExit(({ exitCode }) => {
      dataDisposable.dispose();
      exitDisposable.dispose();
      if (process.stdin.isTTY) {
        process.stdin.off("data", onStdin);
        process.stdin.pause();
        try {
          process.stdin.setRawMode(wasRaw);
        } catch {
          // Restoring raw-mode on a stdin that's already been closed
          // throws; safe to ignore at this point.
        }
        try {
          // Release the auto-ref that `process.stdin.resume()` placed on
          // the TTY fd. Without this the parent Node process keeps the
          // event loop alive forever after the PTY has exited — the
          // exact symptom reported as "trust-configure prints `done` and
          // then never returns".
          process.stdin.unref();
        } catch {
          // ignore — fd may already be gone
        }
      }
      process.stdout.off("resize", onResize);
      process.off("SIGINT", onSigint);
      try {
        // Idempotent on a child that's already exited; on Windows it
        // additionally tells node-pty to tear down the ConPTY agent
        // process and release its libuv handles, which is the second
        // half of why the parent was hanging.
        pty.kill();
      } catch {
        // ignore
      }
      resolve({ exitCode: typeof exitCode === "number" ? exitCode : null });
    });
  });
}

/**
 * Dependencies of `configureTrustWith`. Injected so the function can be
 * unit-tested without touching the npm registry, the network, or a real PTY.
 */
export interface ConfigureTrustDeps {
  readonly findExistingTrust: (pkgName: string) => TrustEntry | null;
  readonly spawnNpm: (
    args: readonly string[],
  ) => Promise<{ exitCode: number | null }>;
  readonly isInteractive: () => boolean;
  readonly log: (msg: string) => void;
  readonly warn: (msg: string) => void;
}

export type ConfigureTrustResult = "ok" | "skipped" | "failed";

/**
 * Pure-functional core of the trust configuration step. The branching here
 * is the contract the unit tests pin down:
 *
 *   1. Fast-path (read, no OTP needed if the operator is inside a cooldown):
 *      if a matching trust is already present, return "skipped".
 *   2. TTY guard: writing requires a fresh 2FA via webauth, which needs a
 *      real TTY. If we're not in one (CI, IDE shell wrapper without pty,
 *      headless cron) we bail out with the exact command the operator can
 *      paste into a real terminal — never crash.
 *   3. Spawn `npm trust github ...` via the injected `spawnNpm`. On a clean
 *      exit (status 0) we're done.
 *   4. Post-mortem idempotency: if the spawn failed, re-read the trust list.
 *      The fresh webauth that just ran should have rinsed any cooldown so
 *      this read succeeds. If the trust is now present, the spawn's failure
 *      was a 409 Conflict (someone beat us, or we're re-running after a
 *      partial bootstrap) and we classify as "skipped".
 *   5. Otherwise the failure is real and we return "failed".
 *
 * Exported for unit testing.
 */
export async function configureTrustWith(
  pkgName: string,
  deps: ConfigureTrustDeps,
): Promise<ConfigureTrustResult> {
  const existing = deps.findExistingTrust(pkgName);
  if (existing) {
    deps.log(
      `[trust-configure]   already configured (id=${existing.id ?? "?"}) — skipping`,
    );
    return "skipped";
  }

  if (!deps.isInteractive()) {
    deps.warn(
      `[trust-configure]   no interactive TTY available; cannot complete the webauth handshake here.`,
    );
    deps.warn(
      `[trust-configure]   run this command from a real terminal to finish:`,
    );
    const argv = buildTrustArgs(pkgName);
    deps.warn(`[trust-configure]     npm ${argv.join(" ")}`);
    return "failed";
  }

  const args = buildTrustArgs(pkgName);
  deps.log(`[trust-configure] $ npm ${args.join(" ")}`);
  const r = await deps.spawnNpm(args);

  if (r.exitCode === 0) {
    deps.log(`[trust-configure]   ok`);
    return "ok";
  }

  // Post-mortem idempotency check: the spawn failed, but if the trust is
  // now present, the registry rejected our POST with 409 Conflict.
  const after = deps.findExistingTrust(pkgName);
  if (after) {
    deps.log(
      `[trust-configure]   already configured (post-mortem confirmed, id=${after.id ?? "?"}) — skipping`,
    );
    return "skipped";
  }

  deps.warn(
    `[trust-configure]   failed (exit ${r.exitCode === null ? "n/a" : r.exitCode})`,
  );
  return "failed";
}

/** Wires real production dependencies for `configureTrustWith`. */
async function configureTrust(pkgName: string): Promise<ConfigureTrustResult> {
  return configureTrustWith(pkgName, {
    findExistingTrust: findExistingMatchingTrust,
    spawnNpm: spawnNpmViaPty,
    isInteractive: isInteractiveTty,
    log: (msg) => console.log(msg),
    warn: (msg) => console.error(msg),
  });
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
    const result = await configureTrust(pkg.name);
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
