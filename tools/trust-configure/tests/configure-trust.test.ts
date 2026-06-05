/**
 * Unit tests for `configureTrustWith` — the pure-functional core of the
 * trust-configuration step.
 *
 * These tests exercise all five branches of the contract:
 *
 *   1. Existing trust on the fast-path read → "skipped" (no spawn at all).
 *   2. No interactive TTY → "failed" + actionable instructions (no spawn).
 *   3. Spawn returns 0 → "ok".
 *   4. Spawn returns ≠0 BUT a post-mortem read finds the trust → "skipped"
 *      (the registry rejected our POST with 409 Conflict, idempotently).
 *   5. Spawn returns ≠0 AND post-mortem also finds nothing → "failed".
 *
 * Dependencies are injected via the `ConfigureTrustDeps` shape so the
 * function can be tested without touching the real npm registry, the
 * network, or `node-pty`.
 */
import { describe, expect, it, vi } from "vitest";
import {
  configureTrustWith,
  isInteractiveTty,
  type ConfigureTrustDeps,
  type TrustEntry,
} from "../src/index.js";

const REPO = "CristianoCiuti/reponova-langs";
const WORKFLOW = "release.yml";
const PKG = "@reponova/lang-tsx";

const EXISTING_TRUST: TrustEntry = {
  id: "abc-123",
  type: "github",
  file: WORKFLOW,
  repository: REPO,
  permissions: ["createPackage"],
};

interface MockDeps extends ConfigureTrustDeps {
  readonly logs: string[];
  readonly warns: string[];
  readonly findExistingCalls: string[];
  spawnCalls: number;
}

interface MakeDepsOverrides {
  findFirst?: TrustEntry | null;
  findSecond?: TrustEntry | null;
  // null is a meaningful value here (PTY torn down without an exit code),
  // so we use a sentinel `"unset"` instead of `??` to distinguish
  // "explicitly null" from "not passed".
  spawnExitCode?: number | null;
  isInteractive?: boolean;
}

function makeDeps(overrides: MakeDepsOverrides = {}): MockDeps {
  const logs: string[] = [];
  const warns: string[] = [];
  const findExistingCalls: string[] = [];
  let findCallCount = 0;
  const spawnExitCode: number | null = "spawnExitCode" in overrides
    ? (overrides.spawnExitCode as number | null)
    : 0;

  return {
    logs,
    warns,
    findExistingCalls,
    spawnCalls: 0,
    findExistingTrust: vi.fn((pkg: string) => {
      findExistingCalls.push(pkg);
      const isFirst = findCallCount === 0;
      findCallCount += 1;
      if (isFirst) return overrides.findFirst ?? null;
      return overrides.findSecond ?? null;
    }),
    spawnNpm: vi.fn(async () => ({ exitCode: spawnExitCode })),
    isInteractive: () => overrides.isInteractive ?? true,
    log: (msg) => logs.push(msg),
    warn: (msg) => warns.push(msg),
  } as MockDeps;
}

describe("configureTrustWith", () => {
  it('returns "skipped" without spawning when the trust is already configured', async () => {
    const deps = makeDeps({ findFirst: EXISTING_TRUST });

    const result = await configureTrustWith(PKG, deps);

    expect(result).toBe("skipped");
    expect(deps.findExistingCalls).toEqual([PKG]);
    expect(deps.spawnNpm).not.toHaveBeenCalled();
    expect(deps.logs.some((l) => l.includes("already configured (id=abc-123)"))).toBe(true);
  });

  it('returns "failed" with paste-ready instructions when no interactive TTY is available', async () => {
    const deps = makeDeps({ findFirst: null, isInteractive: false });

    const result = await configureTrustWith(PKG, deps);

    expect(result).toBe("failed");
    expect(deps.spawnNpm).not.toHaveBeenCalled();
    expect(deps.warns.some((w) => w.includes("no interactive TTY"))).toBe(true);
    expect(
      deps.warns.some((w) => w.includes(`npm trust github ${PKG}`)),
    ).toBe(true);
    expect(
      deps.warns.some((w) => w.includes("--repo CristianoCiuti/reponova-langs")),
    ).toBe(true);
    expect(deps.warns.some((w) => w.includes("--allow-publish"))).toBe(true);
  });

  it('returns "ok" and logs the npm command on a clean spawn (exit 0)', async () => {
    const deps = makeDeps({ findFirst: null, spawnExitCode: 0 });

    const result = await configureTrustWith(PKG, deps);

    expect(result).toBe("ok");
    expect(deps.spawnNpm).toHaveBeenCalledTimes(1);
    expect(deps.spawnNpm).toHaveBeenCalledWith([
      "trust",
      "github",
      PKG,
      "--repo",
      REPO,
      "--file",
      WORKFLOW,
      "--allow-publish",
      "--yes",
    ]);
    expect(deps.logs.some((l) => l.includes("$ npm trust github"))).toBe(true);
    expect(deps.logs.some((l) => l.endsWith("ok"))).toBe(true);
    // No post-mortem read on the happy path (only one find call).
    expect(deps.findExistingCalls.length).toBe(1);
  });

  it('returns "skipped" when the spawn fails but the post-mortem read finds the trust (409 idempotency)', async () => {
    const deps = makeDeps({
      findFirst: null,
      findSecond: EXISTING_TRUST,
      spawnExitCode: 1,
    });

    const result = await configureTrustWith(PKG, deps);

    expect(result).toBe("skipped");
    expect(deps.spawnNpm).toHaveBeenCalledTimes(1);
    expect(deps.findExistingCalls).toEqual([PKG, PKG]);
    expect(
      deps.logs.some((l) => l.includes("already configured (post-mortem confirmed")),
    ).toBe(true);
  });

  it('returns "failed" when the spawn fails AND the post-mortem read finds nothing', async () => {
    const deps = makeDeps({
      findFirst: null,
      findSecond: null,
      spawnExitCode: 1,
    });

    const result = await configureTrustWith(PKG, deps);

    expect(result).toBe("failed");
    expect(deps.spawnNpm).toHaveBeenCalledTimes(1);
    expect(deps.findExistingCalls).toEqual([PKG, PKG]);
    expect(deps.warns.some((w) => w.includes("failed (exit 1)"))).toBe(true);
  });

  it('formats null exit codes as "n/a" in the failure message (e.g. PTY torn down by SIGINT)', async () => {
    const deps = makeDeps({
      findFirst: null,
      findSecond: null,
      spawnExitCode: null,
    });

    const result = await configureTrustWith(PKG, deps);

    expect(result).toBe("failed");
    expect(deps.warns.some((w) => w.includes("failed (exit n/a)"))).toBe(true);
  });

  it('only fast-path reads when the trust is already there, even if the spawn would have crashed', async () => {
    const spawnNpm = vi.fn(async () => {
      throw new Error("spawn must not be called when trust is already configured");
    });
    const deps: ConfigureTrustDeps = {
      findExistingTrust: () => EXISTING_TRUST,
      spawnNpm,
      isInteractive: () => true,
      log: () => {},
      warn: () => {},
    };

    const result = await configureTrustWith(PKG, deps);
    expect(result).toBe("skipped");
    expect(spawnNpm).not.toHaveBeenCalled();
  });

  it('passes the configured repo and workflow through to npm trust args', async () => {
    let capturedArgs: readonly string[] | undefined;
    const deps: ConfigureTrustDeps = {
      findExistingTrust: () => null,
      spawnNpm: async (args) => {
        capturedArgs = args;
        return { exitCode: 0 };
      },
      isInteractive: () => true,
      log: () => {},
      warn: () => {},
    };

    await configureTrustWith("@reponova/lang-something", deps);

    expect(capturedArgs).toBeDefined();
    // The package name lands in slot 2 (after "trust", "github").
    expect(capturedArgs?.[2]).toBe("@reponova/lang-something");
    // The full arg vector contains every flag the registry mandates.
    expect(capturedArgs).toContain("--repo");
    expect(capturedArgs).toContain("--file");
    expect(capturedArgs).toContain("--allow-publish");
    expect(capturedArgs).toContain("--yes");
  });
});

describe("isInteractiveTty", () => {
  it("returns a boolean shape (no throws)", () => {
    expect(typeof isInteractiveTty()).toBe("boolean");
  });

  it("matches the conjunction of process.stdin.isTTY and process.stdout.isTTY", () => {
    const expected =
      process.stdin.isTTY === true && process.stdout.isTTY === true;
    expect(isInteractiveTty()).toBe(expected);
  });
});
