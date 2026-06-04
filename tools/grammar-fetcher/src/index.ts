/**
 * Grammar fetcher CLI.
 *
 * Reads `tools/grammar-fetcher/grammars.json`, downloads pinned tree-sitter
 * .wasm grammars from upstream GitHub releases, verifies SHA-256, and writes
 * them to `packages/<package>/grammars/<filename>`.
 *
 * Usage:
 *   pnpm grammar-fetch                     # fetch all (skip up-to-date)
 *   pnpm grammar-fetch --package=lang-foo  # only matching package(s); repeatable
 *   pnpm grammar-fetch --check             # verify only, exit 1 on mismatch
 *   pnpm grammar-fetch --force             # always re-download
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  buildAssetUrl,
  loadManifest,
  repoRootFromManifest,
  type GrammarEntry,
} from "./manifest.js";
import { downloadBinary } from "./download.js";
import { fileExists, sha256OfBuffer, sha256OfFile } from "./verify.js";

interface CliOptions {
  packages: Set<string>;
  check: boolean;
  force: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const opts: CliOptions = { packages: new Set(), check: false, force: false };
  for (const arg of argv) {
    if (arg === "--" || arg === "") {
      // Tolerated: pnpm/npm forward a bare "--" separator when callers use
      // `pnpm <script> -- ...`. Treat it as a no-op.
      continue;
    }
    if (arg === "--check") {
      opts.check = true;
    } else if (arg === "--force") {
      opts.force = true;
    } else if (arg.startsWith("--package=")) {
      opts.packages.add(arg.slice("--package=".length));
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`[grammar-fetch] unknown argument: ${arg}`);
      printHelp();
      process.exit(2);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`Usage: grammar-fetch [options]

Options:
  --package=<name>   Only process grammars for the given package (repeatable).
                     Example: --package=lang-python
  --check            Verify on-disk SHA-256 against the manifest. No writes.
                     Exit 1 if any grammar is missing or mismatched.
  --force            Re-download even if the on-disk file already matches.
  -h, --help         Show this help.`);
}

function targetPath(repoRoot: string, entry: GrammarEntry): string {
  return join(repoRoot, "packages", entry.package, "grammars", entry.filename);
}

async function processEntry(
  entry: GrammarEntry,
  repoRoot: string,
  opts: CliOptions,
): Promise<"ok" | "wrote" | "mismatch" | "missing"> {
  const dest = targetPath(repoRoot, entry);
  const rel = relative(repoRoot, dest).replace(/\\/g, "/");
  const url = buildAssetUrl(entry.source);

  console.log(`[grammar-fetch] ${entry.id} @ ${entry.source.tag}`);
  console.log(`[grammar-fetch]   target: ${rel}`);

  const exists = await fileExists(dest);
  if (exists) {
    const actual = await sha256OfFile(dest);
    if (actual === entry.sha256) {
      if (!opts.force) {
        console.log(`[grammar-fetch]   ok (sha256 matches manifest)`);
        return "ok";
      }
      console.log(`[grammar-fetch]   forcing re-download (--force)`);
    } else {
      console.log(`[grammar-fetch]   mismatch on disk:`);
      console.log(`[grammar-fetch]     expected ${entry.sha256}`);
      console.log(`[grammar-fetch]     actual   ${actual}`);
      if (opts.check) {
        return "mismatch";
      }
    }
  } else {
    if (opts.check) {
      console.log(`[grammar-fetch]   missing (--check mode)`);
      return "missing";
    }
    console.log(`[grammar-fetch]   not present locally`);
  }

  console.log(`[grammar-fetch]   downloading ${url}`);
  const buf = await downloadBinary(url);
  const actual = sha256OfBuffer(buf);
  if (actual !== entry.sha256) {
    throw new Error(
      `[grammar-fetch] ${entry.id}: SHA-256 mismatch after download.\n` +
        `  expected ${entry.sha256}\n` +
        `  actual   ${actual}\n` +
        `  url      ${url}\n` +
        `Refusing to write a tampered or version-drifted grammar.`,
    );
  }
  if (buf.byteLength !== entry.size) {
    throw new Error(
      `[grammar-fetch] ${entry.id}: size mismatch (expected ${entry.size}, got ${buf.byteLength})`,
    );
  }
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`[grammar-fetch]   verified sha256, wrote ${buf.byteLength} bytes`);
  return "wrote";
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const { manifest, path: manifestPath } = await loadManifest();
  const repoRoot = repoRootFromManifest(manifestPath);

  const filtered = opts.packages.size === 0
    ? manifest.grammars
    : manifest.grammars.filter((g) => opts.packages.has(g.package));

  if (filtered.length === 0) {
    if (opts.packages.size > 0) {
      console.error(
        `[grammar-fetch] no grammars match --package=${[...opts.packages].join(",")}`,
      );
      process.exit(1);
    }
    console.log(`[grammar-fetch] manifest has no grammars; nothing to do`);
    return;
  }

  let ok = 0;
  let wrote = 0;
  let bad = 0;
  for (const entry of filtered) {
    const r = await processEntry(entry, repoRoot, opts);
    if (r === "ok") ok++;
    else if (r === "wrote") wrote++;
    else bad++;
  }

  console.log(
    `[grammar-fetch] done: ${ok} up-to-date, ${wrote} written, ${bad} missing/mismatched`,
  );
  if (bad > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error((err as Error).stack ?? String(err));
  process.exit(1);
});
