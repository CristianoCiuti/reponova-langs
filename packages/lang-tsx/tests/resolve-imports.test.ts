/**
 * Resolution semantics specific to the TSX flavor (.tsx prioritized but
 * .ts/.mts/.cts/.d.ts also tried). The shared `resolveImportPath` logic is
 * covered in `@reponova/lang-typescript-core`; here we assert only the
 * TSX-specific candidate ordering.
 */
import { describe, it, expect } from "vitest";
import { plugin } from "../src/index.js";
import type { TypescriptExtractor } from "@reponova/lang-typescript-core";

const extractor = plugin.extractor as TypescriptExtractor;

describe("TSX resolveImportPath", () => {
  it("returns an empty array for bare specifiers (npm packages)", () => {
    expect(extractor.resolveImportPath("react", "src/App.tsx")).toEqual([]);
    expect(extractor.resolveImportPath("next/image", "src/page.tsx")).toEqual([]);
    expect(extractor.resolveImportPath("@scope/pkg", "src/App.tsx")).toEqual([]);
    expect(extractor.resolveImportPath("node:fs/promises", "src/io.tsx")).toEqual([]);
  });

  it("expands a relative import with .tsx FIRST, then .ts variants", () => {
    const result = extractor.resolveImportPath("./Card", "src/App.tsx");
    expect(result).toContain("src/Card.tsx");
    expect(result).toContain("src/Card.ts");
    expect(result).toContain("src/Card.mts");
    expect(result).toContain("src/Card.cts");
    expect(result).toContain("src/Card.d.ts");
    expect(result).toContain("src/Card/index.tsx");
    expect(result).toContain("src/Card/index.ts");
    expect(result).toContain("src/Card/index.d.ts");

    const tsxIdx = result.indexOf("src/Card.tsx");
    const tsIdx = result.indexOf("src/Card.ts");
    expect(tsxIdx).toBeLessThan(tsIdx);
  });

  it("expands parent-directory relative imports", () => {
    const result = extractor.resolveImportPath("../shared/Button", "src/pages/home.tsx");
    expect(result).toContain("src/shared/Button.tsx");
    expect(result).toContain("src/shared/Button.ts");
    expect(result).toContain("src/shared/Button/index.tsx");
  });

  it("preserves explicit extensions (e.g. `./types.d.ts`)", () => {
    const result = extractor.resolveImportPath("./types.d.ts", "src/api.tsx");
    expect(result).toEqual(["src/types.d.ts"]);
  });

  it("preserves explicit `.tsx` extension", () => {
    const result = extractor.resolveImportPath("./Card.tsx", "src/App.tsx");
    expect(result).toEqual(["src/Card.tsx"]);
  });

  it("normalizes Windows-style paths to posix", () => {
    const result = extractor.resolveImportPath("./Card", "src\\App.tsx");
    expect(result).toContain("src/Card.tsx");
  });
});
