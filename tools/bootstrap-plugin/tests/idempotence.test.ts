/**
 * Pure-function tests for the idempotency contract of the bootstrap-plugin
 * CLI. These tests exist because we shipped a regression where the README
 * advertised the script as "every step is idempotent" but the publish path
 * exited 1 on `EPUBLISHCONFLICT` (cannot publish over previously published
 * versions). The repro:
 *
 *   1. `pnpm bootstrap-plugin lang-json` with npm 11.13 →
 *      step 1 (publish) succeeds, step 2 (trust) bails (trust-configure
 *      requires npm >= 11.15), exit 1.
 *   2. `npm install -g npm@latest` and re-run →
 *      step 1 tries to re-publish 0.2.0, registry rejects it with
 *      `403 cannot publish over the previously published versions`,
 *      bootstrap exits 1 instead of moving on to trust + tag + release.
 *
 * The two helpers exercised below are the surgical fix:
 *
 *   - `parseNpmVersion` aligns the bootstrap preflight with the trust step's
 *     minimum (npm >= 11.15.0), so we never enter the partial-success state.
 *   - `isAlreadyPublishedError` recognises every shape of the
 *     "already published" error npm has emitted in the wild, so a re-run
 *     after a partial success treats the publish step as a no-op.
 *
 * Both helpers are pure: no spawn, no fs, no network. The tests are fast and
 * deterministic and pin the behaviour for every variant we've ever observed.
 */
import { describe, expect, it } from "vitest";

import { isAlreadyPublishedError, parseNpmVersion } from "../src/index.js";

describe("parseNpmVersion", () => {
  it("accepts the minimum supported version (11.15.0)", () => {
    expect(parseNpmVersion("11.15.0")).toEqual({ ok: true, version: "11.15.0" });
  });

  it("accepts a version above the minor floor (11.16.0)", () => {
    expect(parseNpmVersion("11.16.0")).toEqual({ ok: true, version: "11.16.0" });
  });

  it("accepts an outright newer major (12.0.0)", () => {
    expect(parseNpmVersion("12.0.0")).toEqual({ ok: true, version: "12.0.0" });
  });

  it("rejects a version below the minor floor (11.14.99)", () => {
    expect(parseNpmVersion("11.14.99")).toEqual({ ok: false, version: "11.14.99" });
  });

  it("rejects the historic accepted-but-broken minimum (11.13.0)", () => {
    // This is the EXACT version reported in the bug — it used to be accepted
    // by the bootstrap preflight (>= 11.10) but was insufficient for
    // trust-configure (>= 11.15). The whole point of this test is to lock
    // down the alignment.
    expect(parseNpmVersion("11.13.0")).toEqual({ ok: false, version: "11.13.0" });
  });

  it("rejects an old major (10.8.2)", () => {
    expect(parseNpmVersion("10.8.2")).toEqual({ ok: false, version: "10.8.2" });
  });

  it("rejects empty input as <unknown>", () => {
    expect(parseNpmVersion("")).toEqual({ ok: false, version: "<unknown>" });
  });

  it("rejects garbage input but echoes it back trimmed", () => {
    expect(parseNpmVersion("   not-a-version   ")).toEqual({
      ok: false,
      version: "not-a-version",
    });
  });

  it("trims whitespace and trailing newlines from `npm --version`", () => {
    expect(parseNpmVersion("11.16.0\n")).toEqual({ ok: true, version: "11.16.0" });
    expect(parseNpmVersion("  11.16.0\r\n")).toEqual({
      ok: true,
      version: "11.16.0",
    });
  });

  it("honours custom bounds when provided (e.g. for forward compat)", () => {
    expect(
      parseNpmVersion("11.16.0", { minMajor: 12, minMinor: 0 }),
    ).toEqual({ ok: false, version: "11.16.0" });
    expect(
      parseNpmVersion("12.0.1", { minMajor: 12, minMinor: 0 }),
    ).toEqual({ ok: true, version: "12.0.1" });
  });
});

describe("isAlreadyPublishedError", () => {
  it("matches the exact phrase the user hit in the bug report", () => {
    const stderr =
      "npm error You cannot publish over the previously published versions: 0.2.0.\n" +
      "npm error A complete log of this run can be found in: ...";
    expect(isAlreadyPublishedError(stderr)).toBe(true);
  });

  it('matches the singular "version" form some npm builds emit', () => {
    const stderr = "npm error You cannot publish over the previously published version: 1.2.3.";
    expect(isAlreadyPublishedError(stderr)).toBe(true);
  });

  it("matches the EPUBLISHCONFLICT error code (some npm versions surface it)", () => {
    const stderr =
      "npm error code EPUBLISHCONFLICT\n" +
      "npm error 403 Forbidden - PUT https://registry.npmjs.org/@reponova%2flang-json";
    expect(isAlreadyPublishedError(stderr)).toBe(true);
  });

  it("matches the combination of code E403 + 'publish over' phrasing", () => {
    const stderr =
      "npm error code E403\n" +
      "npm error 403 Forbidden - PUT https://registry.npmjs.org/foo - cannot publish over existing version";
    expect(isAlreadyPublishedError(stderr)).toBe(true);
  });

  it("is case-insensitive (be defensive against npm output casing changes)", () => {
    const stderr = "NPM ERROR: YOU CANNOT PUBLISH OVER THE PREVIOUSLY PUBLISHED VERSIONS: 0.2.0";
    expect(isAlreadyPublishedError(stderr)).toBe(true);
  });

  it("does NOT match unrelated 403 errors (e.g. unauthorized scope)", () => {
    const stderr =
      "npm error code E403\n" +
      "npm error 403 Forbidden - PUT https://registry.npmjs.org/@reponova%2flang-json - You do not have permission to publish \"@reponova/lang-json\"";
    expect(isAlreadyPublishedError(stderr)).toBe(false);
  });

  it("does NOT match a network error", () => {
    const stderr =
      "npm error code ECONNRESET\n" +
      "npm error network: socket hang up";
    expect(isAlreadyPublishedError(stderr)).toBe(false);
  });

  it("does NOT match an authentication failure", () => {
    const stderr =
      "npm error code ENEEDAUTH\n" +
      "npm error need auth You need to authorize this machine using `npm adduser`";
    expect(isAlreadyPublishedError(stderr)).toBe(false);
  });

  it("returns false for empty / whitespace-only input", () => {
    expect(isAlreadyPublishedError("")).toBe(false);
    expect(isAlreadyPublishedError("   \n\n\t  ")).toBe(false);
  });
});
