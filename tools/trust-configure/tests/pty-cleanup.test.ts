/**
 * Smoke test: PTY cleanup contract.
 *
 * The unit tests in `configure-trust.test.ts` cover the LOGIC of the trust
 * configuration step (the five branches of `configureTrustWith`) by mocking
 * `spawnNpm`. They cannot detect the kind of bug this file is here to
 * prevent: process-termination leaks that only manifest when a real PTY
 * runs to completion.
 *
 * The leak we're guarding against:
 *
 *   `trust-configure` finishes its loop, prints
 *   `done: 1 ok, 5 already-configured (skipped), 0 failed`,
 *   and then HANGS forever — the parent Node event loop is still alive
 *   because `node-pty` has dangling libuv handles AND/OR
 *   `process.stdin.resume()` auto-ref'd the TTY fd that `pause()` did
 *   not unref. The fix in `spawnNpmViaPty` is to add explicit
 *   `pty.kill()` plus `process.stdin.unref()` in the `onExit` handler.
 *
 * The only deterministic regression test for "did the event loop drain?"
 * is to spawn a fresh Node child that calls `spawnNpmViaPty` with a
 * fast-completing argv, then assert the child exits within a bounded
 * wall-clock window. Two flavours:
 *
 *   1. Child is launched via `node-pty` itself, so stdin IS a TTY.
 *      This is the regression path: it exercises the `setRawMode` /
 *      `resume` / `unref` branch where the leak lives.
 *   2. Child is launched via `child_process.spawn` with `stdio: "ignore"`,
 *      so stdin is NOT a TTY. The TTY-cleanup branch is skipped, so the
 *      child should drain even faster — sanity check that the non-TTY
 *      path was never broken.
 *
 * The harness script invokes `spawnNpmViaPty(["--version"])`. `npm --version`
 * is a no-op-class command (no network, no auth, no 2FA) so the PTY exits
 * within sub-second wall time on every platform we ship for.
 */
import { describe, expect, it } from "vitest";
import { spawn as childSpawn } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

// Wall-clock budget for the child to:
//   1. boot Node + tsx
//   2. import spawnNpmViaPty (which dynamic-imports node-pty + binding)
//   3. run `npm --version`
//   4. drain its event loop and exit cleanly
//
// 30s is generous on the slowest of our CI matrix (Windows + node 18 cold
// cache). With the leak, the child stays alive *forever*, so any value
// above the worst-case "successful" runtime is a sufficient discriminator.
const CHILD_TIMEOUT_MS = 30_000;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = resolve(packageRoot, "src/index.ts");
// `import("…")` requires a `file://…` URL on Windows (a bare drive-letter
// path like `C:/Users/...` is treated as an unsupported URL scheme). We
// embed this URL into the harness source verbatim, so it has to be a
// well-formed file URL that survives both Windows backslash → slash
// translation and any drive-letter encoding quirks.
const indexUrl = pathToFileURL(indexPath).href;

/**
 * Harness: a tiny TS script that imports `spawnNpmViaPty` from this very
 * package and runs it against `npm --version`. After the awaited promise
 * resolves, the script does NOT call `process.exit()` — the entire point
 * of the test is to assert that Node terminates on its own once the loop
 * is empty.
 *
 * The trailing `HARNESS_DONE` marker lets the test confirm the call
 * completed (exit 0) before the child closes its stdout, separating
 * "child ran the function and then drained" from "child crashed before
 * the function returned" if the test ever flakes.
 */
const harnessSource = `
import { spawnNpmViaPty } from "${indexUrl}";

const r = await spawnNpmViaPty(["--version"]);
process.stdout.write(\`HARNESS_DONE exit=\${r.exitCode}\\n\`);
// Intentionally NO process.exit() — we want the loop to drain on its own.
`;

interface ChildOutcome {
  readonly exitCode: number | null;
  readonly elapsedMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly killedByTimeout: boolean;
}

/**
 * Run the harness as a child Node process via plain `child_process.spawn`.
 * stdin is `"ignore"` so `process.stdin.isTTY` is `false` inside the child;
 * the TTY-cleanup branch in `spawnNpmViaPty.onExit` is skipped. This is
 * the sanity-check half of the smoke test.
 *
 * cwd is pinned to `packageRoot` so that `--import tsx/esm` resolves the
 * tsx loader through this package's local `node_modules` (Vitest happens
 * to run from the same cwd today, but pinning makes the test independent
 * of how it's invoked).
 */
async function runHarnessNonTty(): Promise<ChildOutcome> {
  const tmp = mkdtempSync(join(tmpdir(), "trust-configure-pty-"));
  const harnessPath = join(tmp, "harness.mts");
  writeFileSync(harnessPath, harnessSource, "utf8");

  const startedAt = Date.now();
  return await new Promise<ChildOutcome>((resolveOutcome) => {
    const child = childSpawn(
      process.execPath,
      ["--import", "tsx/esm", harnessPath],
      {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: packageRoot,
        env: process.env,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => { stdout += b.toString("utf8"); });
    child.stderr.on("data", (b: Buffer) => { stderr += b.toString("utf8"); });

    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      try { child.kill("SIGKILL"); } catch { /* race with natural exit */ }
    }, CHILD_TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
      resolveOutcome({
        exitCode: code,
        elapsedMs: Date.now() - startedAt,
        stdout,
        stderr,
        killedByTimeout,
      });
    });
  });
}

/**
 * Probes `node-pty` to check whether the current host can allocate a
 * pseudo-terminal at all. Returns `null` on success, or the error message
 * on failure.
 *
 * The GitHub Actions `macos-latest` runners refuse `posix_spawnp(forkpty)`
 * out of the box (we observed `posix_spawnp failed.` on Node 18/20/22).
 * That's an environment limitation — nothing to do with the production
 * fix — so the regression test that needs a real PTY is skipped on hosts
 * where the syscall is unavailable. Linux and Windows runners pass.
 */
async function probePtyAvailability(): Promise<string | null> {
  try {
    const { spawn: ptySpawn } = await import("node-pty");
    const probe = ptySpawn(process.execPath, ["--version"], {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env as Record<string, string | undefined>,
    });
    await new Promise<void>((resolveProbe) => {
      probe.onExit(() => resolveProbe());
    });
    return null;
  } catch (err) {
    return (err as Error).message ?? String(err);
  }
}

/**
 * Run the harness as a child whose stdin IS a real TTY, by launching it
 * through `node-pty`. This exercises the exact code path that leaked:
 * `setRawMode(true)` + `resume()` + `unref()` in `spawnNpmViaPty.onExit`.
 *
 * `node-pty` is already a devDependency for the production code path, so
 * this test costs nothing extra in deps.
 */
async function runHarnessTty(): Promise<ChildOutcome> {
  const { spawn: ptySpawn } = await import("node-pty");

  const tmp = mkdtempSync(join(tmpdir(), "trust-configure-pty-"));
  const harnessPath = join(tmp, "harness.mts");
  writeFileSync(harnessPath, harnessSource, "utf8");

  const startedAt = Date.now();
  return await new Promise<ChildOutcome>((resolveOutcome) => {
    const pty = ptySpawn(
      process.execPath,
      ["--import", "tsx/esm", harnessPath],
      {
        name: "xterm-color",
        cols: 80,
        rows: 24,
        cwd: packageRoot,
        env: process.env as Record<string, string | undefined>,
      },
    );
    let stdout = "";

    const dataDisposable = pty.onData((d: string) => { stdout += d; });

    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      try { pty.kill(); } catch { /* race */ }
    }, CHILD_TIMEOUT_MS);

    const exitDisposable = pty.onExit(({ exitCode }) => {
      clearTimeout(timer);
      dataDisposable.dispose();
      exitDisposable.dispose();
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
      resolveOutcome({
        exitCode: typeof exitCode === "number" ? exitCode : null,
        elapsedMs: Date.now() - startedAt,
        stdout,
        stderr: "",
        killedByTimeout,
      });
    });
  });
}

describe("spawnNpmViaPty: process-termination contract", () => {
  it(
    "child Node terminates within the budget when stdin is NOT a TTY (sanity check)",
    async () => {
      const r = await runHarnessNonTty();
      const debug = `exit=${r.exitCode} elapsed=${r.elapsedMs}ms stdout=${JSON.stringify(r.stdout.slice(0, 400))} stderr=${JSON.stringify(r.stderr.slice(0, 400))}`;
      expect(r.killedByTimeout, `child hung past ${CHILD_TIMEOUT_MS}ms; ${debug}`).toBe(false);
      expect(r.stdout, `harness produced no expected marker; ${debug}`).toMatch(/HARNESS_DONE exit=0/);
      expect(r.exitCode, `harness exited non-zero; ${debug}`).toBe(0);
    },
    CHILD_TIMEOUT_MS + 5_000,
  );

  it(
    "child Node terminates within the budget when stdin IS a TTY (regression for the trust-configure hang)",
    async (ctx) => {
      // GH Actions `macos-latest` runners refuse `posix_spawnp(forkpty)`,
      // which makes `node-pty` unable to allocate a PTY at all on that
      // host. That's an environment limitation, not a regression in the
      // production fix — Linux and Windows runners exercise the same
      // code path. Skip rather than red-X CI on hosts that can't host
      // the test infrastructure.
      const ptyError = await probePtyAvailability();
      if (ptyError !== null) {
        ctx.skip(`PTY unavailable on this host (${ptyError}); the production fix still applies but cannot be smoke-tested here`);
        return;
      }

      const r = await runHarnessTty();
      const debug = `exit=${r.exitCode} elapsed=${r.elapsedMs}ms stdout=${JSON.stringify(r.stdout.slice(0, 600))}`;
      expect(r.killedByTimeout, `child hung past ${CHILD_TIMEOUT_MS}ms (the bug reproduces); ${debug}`).toBe(false);
      expect(r.stdout, `harness produced no expected marker; ${debug}`).toMatch(/HARNESS_DONE exit=0/);
      expect(r.exitCode, `harness exited non-zero; ${debug}`).toBe(0);
    },
    CHILD_TIMEOUT_MS + 5_000,
  );
});
