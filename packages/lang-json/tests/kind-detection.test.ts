import { describe, expect, it } from "vitest";
import { detectJsonKind } from "../src/index.js";

describe("detectJsonKind", () => {
  it.each([
    ["package.json", "package"],
    ["repo/package.json", "package"],
    ["repo/packages/widget/package.json", "package"],
  ])("recognises %s as package", (path, expected) => {
    expect(detectJsonKind(path)).toBe(expected);
  });

  it.each([
    "tsconfig.json",
    "tsconfig.base.json",
    "tsconfig.node.json",
    "tsconfig.spec.json",
    "apps/web/tsconfig.json",
    "tsconfig.lib.json",
  ])("recognises %s as tsconfig", (path) => {
    expect(detectJsonKind(path)).toBe("tsconfig");
  });

  it.each([
    ["nx.json", "nx"],
    ["repo/nx.json", "nx"],
    ["project.json", "project"],
    ["libs/auth/project.json", "project"],
    ["lerna.json", "lerna"],
    ["turbo.json", "turbo"],
  ])("recognises %s as %s", (path, expected) => {
    expect(detectJsonKind(path)).toBe(expected);
  });

  it.each([
    "settings.json",
    "tsbuild.json",                     // not a tsconfig pattern
    "tsconfigplus.json",                // close but no leading separator
    "deeply/nested/tsconfig.todo.json", // valid tsconfig with custom suffix → tsconfig
    "vite.json",
    "package-lock.json",
    "data/seed.json",
  ])("falls back to generic for %s when not a known schema", (path) => {
    const k = detectJsonKind(path);
    if (path === "deeply/nested/tsconfig.todo.json") {
      expect(k).toBe("tsconfig");
    } else {
      expect(k).toBe("generic");
    }
  });

  it("is case-insensitive on the filename", () => {
    expect(detectJsonKind("Package.JSON")).toBe("package");
    expect(detectJsonKind("apps/web/TSCONFIG.JSON")).toBe("tsconfig");
  });

  it("normalises Windows backslashes when scanning the basename", () => {
    expect(detectJsonKind("repo\\packages\\widget\\package.json")).toBe("package");
    expect(detectJsonKind("apps\\web\\tsconfig.json")).toBe("tsconfig");
  });
});
