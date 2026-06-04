import { describe, expect, it } from "vitest";
import { TypescriptExtractor } from "../src/extractor.js";

describe("TypescriptExtractor.resolveImportPath", () => {
  const ext = new TypescriptExtractor();

  it("returns an empty array for bare specifiers (npm packages)", () => {
    expect(ext.resolveImportPath("express", "src/app.ts")).toEqual([]);
    expect(ext.resolveImportPath("@reponova/lang-python", "src/index.ts")).toEqual([]);
    expect(ext.resolveImportPath("node:fs/promises", "src/io.ts")).toEqual([]);
  });

  it("expands relative imports with all known extensions and index files", () => {
    const result = ext.resolveImportPath("./utils", "src/index.ts");
    expect(result).toContain("src/utils.ts");
    expect(result).toContain("src/utils.mts");
    expect(result).toContain("src/utils.cts");
    expect(result).toContain("src/utils.d.ts");
    expect(result).toContain("src/utils/index.ts");
    expect(result).toContain("src/utils/index.d.ts");
  });

  it("resolves parent-directory relative imports", () => {
    const result = ext.resolveImportPath("../shared/format", "src/cli/main.ts");
    expect(result).toContain("src/shared/format.ts");
    expect(result).toContain("src/shared/format/index.ts");
  });

  it("preserves an explicit extension when present", () => {
    const result = ext.resolveImportPath("./schema.d.ts", "src/api.ts");
    expect(result).toEqual(["src/schema.d.ts"]);
  });

  it("normalizes Windows-style paths to posix", () => {
    const result = ext.resolveImportPath("./utils", "src\\index.ts");
    expect(result).toContain("src/utils.ts");
  });
});
