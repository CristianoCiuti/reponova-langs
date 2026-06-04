/**
 * Bootstrap a brand-new @reponova/lang-* package on npm with OIDC Trusted
 * Publisher in a single guided flow:
 *
 *   1. npm publish --access public  (cwd: packages/<package-dir>)
 *   2. pnpm trust:configure --apply (cwd: monorepo root)
 *
 * From the second version onward the GitHub Actions release workflow can
 * publish via OIDC alone, with no further manual step.
 *
 * Usage:
 *   pnpm bootstrap-plugin lang-typescript           # interactive
 *   pnpm bootstrap-plugin lang-typescript --yes     # skip confirmation prompt
 *   pnpm bootstrap-plugin lang-typescript --skip-publish   # only configure trust
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCOPE_PREFIX = "@reponova/lang-";

interface PackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
}

interface CliOptions {
  readonly packageDir: string;
  readonly skipPublish: boolean;
  readonly skipTrust: boolean;
  readonly yes: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let packageDir: string | undefined;
  let skipPublish = false;
  let skipTrust = false;
  let yes = false;

  for (const arg of argv) {
    if (arg === "--" || arg === "") continue;
    if (arg === "--skip-publish") {
      skipPublish = true;
    } else if (arg === "--skip-trust") {
      skipTrust = true;
    } else if (arg === "--yes" || arg === "-y") {
      yes = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("--")) {
      console.error(`[bootstrap-plugin] unknown argument: ${arg}`);
      printHelp();
      process.exit(2);
    } else if (!packageDir) {
      packageDir = arg;
    } else {
      console.error(`[bootstrap-plugin] unexpected positional argument: ${arg}`);
      printHelp();
      process.exit(2);
    }
  }

  if (!packageDir) {
    console.error(`[bootstrap-plugin] missing required argument: <package-dir>`);
    printHelp();
    process.exit(2);
  }

  return { packageDir, skipPublish, skipTrust, yes };
}

function printHelp(): void {
  console.log(`Usage: bootstrap-plugin <package-dir> [options]

Bootstraps a brand-new @reponova/lang-* package on npm with OIDC Trusted
Publisher. Run this once per new plugin. From the next version bump onward,
the Release workflow publishes automatically via OIDC.

Arguments:
  <package-dir>      Directory name under packages/ (e.g. lang-typescript).
                     The package.json must declare a name @reponova/lang-*
                     and must NOT be private.

Options:
  -y, --yes          Skip the confirmation prompt before publishing.
  --skip-publish     Don't run npm publish (e.g. if it already succeeded).
  --skip-trust       Don't run pnpm trust:configure (rare).
  -h, --help         Show this help.

Prerequisites:
  - npm CLI >= 11.10.0 (required by the trust subcommand)
  - You are logged in to npm: \`npm login\`
  - When 2FA is requested on the first prompt, accept "skip 2FA for the
    next 5 minutes" so the trust step doesn't ask again.`);
}

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/index.ts -> ../../../ = monorepo root
  return resolve(here, "..", "..", "..");
}

async function loadPackageJson(
  packageDir: string,
  root: string,
): Promise<{ pj: PackageJson; absPackageDir: string }> {
  const absPackageDir = resolve(root, "packages", packageDir);
  const pjPath = join(absPackageDir, "package.json");
  let raw: string;
  try {
    raw = await readFile(pjPath, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${pjPath}: ${(err as Error).message}`);
  }
  let pj: PackageJson;
  try {
    pj = JSON.parse(raw) as PackageJson;
  } catch (err) {
    throw new Error(`${pjPath} is not valid JSON: ${(err as Error).message}`);
  }
  return { pj, absPackageDir };
}

function checkNpmVersion(): { ok: boolean; version: string } {
  const r = spawnSync("npm", ["--version"], { encoding: "utf8", shell: true });
  if (r.status !== 0) return { ok: false, version: "<unknown>" };
  const version = r.stdout.trim();
  const [maj, min] = version.split(".").map((n) => Number(n));
  if (typeof maj !== "number" || Number.isNaN(maj)) return { ok: false, version };
  if (maj > 11) return { ok: true, version };
  if (maj === 11 && (min ?? 0) >= 10) return { ok: true, version };
  return { ok: false, version };
}

function checkNpmAuth(): { ok: boolean; user: string } {
  const r = spawnSync("npm", ["whoami"], { encoding: "utf8", shell: true });
  if (r.status !== 0) return { ok: false, user: "" };
  return { ok: true, user: r.stdout.trim() };
}

function checkAlreadyPublished(name: string, version: string): "yes" | "no" | "unknown" {
  const r = spawnSync("npm", ["view", `${name}@${version}`, "version"], {
    encoding: "utf8",
    shell: true,
  });
  if (r.status === 0 && r.stdout.trim() === version) return "yes";
  const stderr = r.stderr ?? "";
  if (stderr.includes("E404") || stderr.includes("404 Not Found")) return "no";
  return "unknown";
}

async function confirmPrompt(message: string, defaultYes: boolean): Promise<boolean> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const yn = defaultYes ? "[Y/n]" : "[y/N]";
  try {
    const answer = await rl.question(`${message} ${yn} `);
    if (!answer.trim()) return defaultYes;
    return answer.trim().toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const root = repoRoot();

  console.log(`[bootstrap-plugin] root:   ${root}`);
  console.log(`[bootstrap-plugin] target: packages/${opts.packageDir}`);
  console.log("");

  const { pj, absPackageDir } = await loadPackageJson(opts.packageDir, root);
  if (!pj.name) {
    throw new Error(`packages/${opts.packageDir}/package.json has no "name"`);
  }
  if (!pj.version) {
    throw new Error(`packages/${opts.packageDir}/package.json has no "version"`);
  }
  if (pj.private === true) {
    throw new Error(`packages/${opts.packageDir} is marked private — refusing to publish`);
  }
  if (!pj.name.startsWith(SCOPE_PREFIX)) {
    throw new Error(
      `packages/${opts.packageDir} package name "${pj.name}" does not match ${SCOPE_PREFIX}*`,
    );
  }

  console.log(`[bootstrap-plugin] package: ${pj.name}@${pj.version}`);
  console.log("");

  const willPublish = !opts.skipPublish;
  const willTrust = !opts.skipTrust;

  if (willPublish || willTrust) {
    const v = checkNpmVersion();
    if (!v.ok) {
      console.error(
        `[bootstrap-plugin] npm >= 11.10.0 required (got ${v.version}). run: npm install -g npm@latest`,
      );
      process.exit(1);
    }
    const auth = checkNpmAuth();
    if (!auth.ok) {
      console.error(`[bootstrap-plugin] not authenticated. run: npm login`);
      process.exit(1);
    }
    console.log(`[bootstrap-plugin] npm version: ${v.version}`);
    console.log(`[bootstrap-plugin] npm user:    ${auth.user}`);
    console.log("");
  }

  if (willPublish) {
    const status = checkAlreadyPublished(pj.name, pj.version);
    if (status === "yes") {
      console.log(
        `[bootstrap-plugin] ${pj.name}@${pj.version} is already published — skipping publish step`,
      );
    } else {
      if (status === "unknown") {
        console.log(
          `[bootstrap-plugin] could not check npm registry for ${pj.name}@${pj.version}; will attempt publish anyway`,
        );
      }
      if (!opts.yes) {
        const ok = await confirmPrompt(
          `[bootstrap-plugin] About to run \`npm publish --access public\` for ${pj.name}@${pj.version}. Continue?`,
          true,
        );
        if (!ok) {
          console.log(`[bootstrap-plugin] aborted by user`);
          process.exit(1);
        }
      }
      console.log(
        `[bootstrap-plugin] $ npm publish --access public  (cwd: ${absPackageDir})`,
      );
      const r = spawnSync("npm", ["publish", "--access", "public"], {
        cwd: absPackageDir,
        stdio: "inherit",
        shell: true,
      });
      if (r.status !== 0) {
        console.error(`[bootstrap-plugin] npm publish failed (exit ${r.status})`);
        process.exit(1);
      }
      console.log(`[bootstrap-plugin] published ${pj.name}@${pj.version}`);
    }
    console.log("");
  }

  if (willTrust) {
    console.log(`[bootstrap-plugin] $ pnpm trust:configure --apply  (cwd: ${root})`);
    const r = spawnSync("pnpm", ["trust:configure", "--apply"], {
      cwd: root,
      stdio: "inherit",
      shell: true,
    });
    if (r.status !== 0) {
      console.error(`[bootstrap-plugin] trust:configure failed (exit ${r.status})`);
      process.exit(1);
    }
    console.log("");
  }

  console.log(
    `[bootstrap-plugin] done. ${pj.name} is ready for OIDC publishing from CI.`,
  );
  console.log(
    `[bootstrap-plugin] from the next version bump, no manual step is required.`,
  );
}

main().catch((err) => {
  console.error((err as Error).stack ?? String(err));
  process.exit(1);
});
