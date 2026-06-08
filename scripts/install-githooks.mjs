#!/usr/bin/env node
/**
 * Installs this repo's pre-commit guard WITHOUT touching `core.hooksPath`.
 *
 * Why not `core.hooksPath`?
 * ------------------------
 * Many developers configure `init.templateDir` (or `core.hooksPath` itself)
 * at the user/system level to share personal hooks across every repo they
 * touch — e.g. a `prepare-commit-msg` that prefixes the branch name to the
 * commit message. Setting `core.hooksPath` locally in this repo would
 * silently override those user-level hooks (because `core.hooksPath` is a
 * directory swap, not a path append). Bad neighbor behavior.
 *
 * Strategy
 * --------
 * We install a thin wrapper at `.git/hooks/pre-commit` — the *default*
 * location git looks at when `core.hooksPath` is unset. The wrapper
 * delegates the heavy lifting to the committed file `.githooks/pre-commit`,
 * so the actual rules live in the repo (versioned, code-reviewable, shared
 * with everyone).
 *
 * Coexistence rules:
 *   • Hooks at other names (e.g. `prepare-commit-msg` from your global
 *     template) are not touched — they keep working as before.
 *   • If `.git/hooks/pre-commit` already exists and is NOT ours, we move it
 *     to `.git/hooks/pre-commit.before-reponova-langs` and our wrapper
 *     chains to it: our guard runs first, then theirs (only if ours passes).
 *   • If `.git/hooks/pre-commit` already exists and IS ours (recognized by
 *     a marker line), it's a no-op rewrite — safe to call repeatedly from
 *     `pnpm install`.
 *   • If the user explicitly set `core.hooksPath` (local/global/system) to
 *     a value different from `.git/hooks/`, we leave a note and exit 0 —
 *     a wrapper in `.git/hooks/` won't fire under those conditions, and
 *     blindly installing one elsewhere (e.g. into the user's personal
 *     hooks dir) would pollute every other repo they touch. The user can
 *     manually wire `.githooks/pre-commit` into their setup if they want
 *     the guard.
 *
 * Failure-tolerant: any unexpected error prints a warning and exits 0 so a
 * broken hook install never blocks `pnpm install`.
 */
import {
  existsSync,
  readdirSync,
  chmodSync,
  statSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_SRC_DIR = resolve(REPO_ROOT, ".githooks");
const GIT_HOOKS_DIR = resolve(REPO_ROOT, ".git", "hooks");
const PRE_COMMIT = resolve(GIT_HOOKS_DIR, "pre-commit");
const PRE_COMMIT_BACKUP = resolve(GIT_HOOKS_DIR, "pre-commit.before-reponova-langs");
const MARKER = "REPONOVA_LANGS_PRE_COMMIT_WRAPPER";

function warn(msg) {
  console.warn(`[install-githooks] ${msg}`);
}

// ─── 0. Sanity ───────────────────────────────────────────────────────────────
if (!existsSync(resolve(REPO_ROOT, ".git"))) {
  process.exit(0); // not a git checkout (e.g. tarball install)
}
if (!existsSync(HOOKS_SRC_DIR)) {
  warn(`.githooks/ missing — skipping`);
  process.exit(0);
}

// ─── 1. Refuse if core.hooksPath is set anywhere to anything but default ─────
// We probe the *effective* value (without --local), which returns whatever
// git is actually using: local > global > system. If it's set to something
// other than `.git/hooks` (the default — never explicitly stored), the user
// has opted in to a custom hook setup and we mustn't fight them.
const probe = spawnSync("git", ["config", "--get", "core.hooksPath"], {
  cwd: REPO_ROOT,
  encoding: "utf-8",
  shell: false,
});
const customHooksPath = (probe.stdout ?? "").trim();
if (customHooksPath) {
  warn(`core.hooksPath is set to "${customHooksPath}" — leaving your hook setup alone.`);
  warn(`to enable this repo's guard manually, source .githooks/pre-commit from your own hook,`);
  warn(`or run: git config --local --unset core.hooksPath  (then re-run \`pnpm install\`).`);
  process.exit(0);
}

// ─── 2. Make sure .githooks/* are executable on filesystems that honor it ────
try {
  for (const name of readdirSync(HOOKS_SRC_DIR)) {
    const p = resolve(HOOKS_SRC_DIR, name);
    if (!statSync(p).isFile()) continue;
    try {
      chmodSync(p, 0o755);
    } catch {
      // chmod is a no-op on some Windows filesystems; git runs hooks regardless.
    }
  }
} catch (err) {
  warn(`chmod sweep failed: ${err.message}`);
}

// ─── 3. Decide what to do with any existing .git/hooks/pre-commit ────────────
let installedByUs = false;
let chainTo = null; // path our wrapper should call after our own check

if (existsSync(PRE_COMMIT)) {
  let body = "";
  try {
    body = readFileSync(PRE_COMMIT, "utf-8");
  } catch {
    // ignore — we'll treat as "unknown content" and back up
  }
  if (body.includes(MARKER)) {
    installedByUs = true;
    // Preserve whatever chain target the previous install already set up.
    if (existsSync(PRE_COMMIT_BACKUP)) chainTo = PRE_COMMIT_BACKUP;
  } else {
    // Not ours — back it up so we don't lose the user's earlier hook.
    try {
      renameSync(PRE_COMMIT, PRE_COMMIT_BACKUP);
      chainTo = PRE_COMMIT_BACKUP;
      console.log(`[install-githooks] backed up existing pre-commit → ${PRE_COMMIT_BACKUP}`);
    } catch (err) {
      warn(`could not back up existing pre-commit: ${err.message}`);
      warn(`refusing to overwrite — install aborted (no guard installed).`);
      process.exit(0);
    }
  }
}

// ─── 4. Write the wrapper ────────────────────────────────────────────────────
const chainBlock = chainTo
  ? `
# Chain to the pre-commit hook that existed BEFORE this wrapper was
# installed (e.g. from a personal git templateDir or another tool). Only
# executed if our own check above succeeded.
if [ -x "${chainTo.replace(/\\/g, "/")}" ]; then
  exec "${chainTo.replace(/\\/g, "/")}" "$@"
fi
`
  : "";

const wrapper = `#!/bin/sh
# ${MARKER}=v1
# Installed by scripts/install-githooks.mjs from reponova-langs.
# Do NOT edit by hand — the file is regenerated on every \`pnpm install\`.
# The repo-shared rules live in .githooks/pre-commit (committed).
set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
SHARED_HOOK="$REPO_ROOT/.githooks/pre-commit"

if [ -x "$SHARED_HOOK" ]; then
  "$SHARED_HOOK" "$@"
elif [ -f "$SHARED_HOOK" ]; then
  # Filesystem may not preserve +x (e.g. some Windows setups); fall back to sh.
  sh "$SHARED_HOOK" "$@"
fi
${chainBlock}`;

writeFileSync(PRE_COMMIT, wrapper, "utf-8");
try {
  chmodSync(PRE_COMMIT, 0o755);
} catch {
  // Windows: no-op.
}

if (installedByUs) {
  console.log(`[install-githooks] pre-commit wrapper already in place — refreshed.`);
} else {
  console.log(`[install-githooks] installed .git/hooks/pre-commit wrapper.`);
  if (chainTo) {
    console.log(`[install-githooks] chaining to previous hook at ${PRE_COMMIT_BACKUP}`);
  }
}
