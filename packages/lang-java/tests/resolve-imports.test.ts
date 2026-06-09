import { describe, it, expect } from "vitest";
import { JavaExtractor } from "../src/index.js";

const ext = new JavaExtractor();

describe("JavaExtractor.resolveImportPath", () => {
  it("converts a dotted type import to a slashed `.java` path", () => {
    expect(ext.resolveImportPath("com.example.foo.Bar", "src/Anything.java")).toEqual([
      "com/example/foo/Bar.java",
    ]);
  });

  it("returns an empty array for wildcard imports (no single candidate file)", () => {
    expect(ext.resolveImportPath("com.example.util.*", "src/Anything.java")).toEqual([]);
  });

  it("returns an empty array for an empty input", () => {
    expect(ext.resolveImportPath("", "src/Anything.java")).toEqual([]);
  });

  it("drops the trailing lowercase member from a static import path", () => {
    // `java.util.Collections.emptyList` → resolve to `java/util/Collections.java`
    expect(ext.resolveImportPath("java.util.Collections.emptyList", "src/Anything.java")).toEqual([
      "java/util/Collections.java",
    ]);
  });

  it("preserves a trailing PascalCase segment even if it ends with a lowercase letter", () => {
    // Heuristic guard: the trailing-member trim only kicks in when the LAST
    // segment is lowercase-initial AND the previous segment is uppercase-initial.
    // For `java.util.Map` we keep all three segments.
    expect(ext.resolveImportPath("java.util.Map", "src/Anything.java")).toEqual([
      "java/util/Map.java",
    ]);
  });

  it("does not strip when both penultimate and last segments are lowercase", () => {
    // Defensive: a malformed import like `a.b.c` (all lowercase) — we don't
    // strip because the heuristic only triggers on the lowercase-after-Pascal
    // shape that indicates a static member import.
    expect(ext.resolveImportPath("a.b.c", "src/Anything.java")).toEqual(["a/b/c.java"]);
  });

  it("returns a single-segment input as a top-level `.java` file", () => {
    expect(ext.resolveImportPath("Bar", "src/Anything.java")).toEqual(["Bar.java"]);
  });
});
