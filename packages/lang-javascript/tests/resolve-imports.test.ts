/**
 * Resolution semantics specific to the JavaScript flavor (.js prioritized
 * but .mjs/.cjs/.jsx also tried). The shared `resolveImportPath` logic is
 * covered in `@reponova/lang-typescript-core`; here we assert only the
 * JS-specific candidate ordering and the exact JS dialect set.
 */
import { describe, it, expect } from "vitest";
import { plugin } from "../src/index.js";
import type { TypescriptExtractor } from "@reponova/lang-typescript-core";

const extractor = plugin.extractor as TypescriptExtractor;

describe("JavaScript resolveImportPath", () => {
  it("returns an empty array for bare specifiers (npm packages)", () => {
    expect(extractor.resolveImportPath("react", "src/App.jsx")).toEqual([]);
    expect(extractor.resolveImportPath("express", "src/server.js")).toEqual([]);
    expect(extractor.resolveImportPath("@scope/pkg", "src/App.js")).toEqual([]);
    expect(extractor.resolveImportPath("node:fs/promises", "src/io.js")).toEqual([]);
  });

  it("expands a relative import with .js FIRST, then .mjs/.cjs/.jsx variants", () => {
    const result = extractor.resolveImportPath("./Card", "src/App.js");
    expect(result).toContain("src/Card.js");
    expect(result).toContain("src/Card.mjs");
    expect(result).toContain("src/Card.cjs");
    expect(result).toContain("src/Card.jsx");
    expect(result).toContain("src/Card/index.js");
    expect(result).toContain("src/Card/index.mjs");
    expect(result).toContain("src/Card/index.cjs");
    expect(result).toContain("src/Card/index.jsx");

    const jsIdx = result.indexOf("src/Card.js");
    const mjsIdx = result.indexOf("src/Card.mjs");
    const jsxIdx = result.indexOf("src/Card.jsx");
    expect(jsIdx).toBeLessThan(mjsIdx);
    expect(jsIdx).toBeLessThan(jsxIdx);
  });

  it("expands parent-directory relative imports", () => {
    const result = extractor.resolveImportPath("../shared/Button", "src/pages/home.js");
    expect(result).toContain("src/shared/Button.js");
    expect(result).toContain("src/shared/Button.jsx");
    expect(result).toContain("src/shared/Button/index.js");
  });

  it("preserves explicit `.mjs` extension", () => {
    const result = extractor.resolveImportPath("./esm-config.mjs", "src/index.js");
    expect(result).toEqual(["src/esm-config.mjs"]);
  });

  it("preserves explicit `.cjs` extension", () => {
    const result = extractor.resolveImportPath("./legacy.cjs", "src/index.js");
    expect(result).toEqual(["src/legacy.cjs"]);
  });

  it("preserves explicit `.jsx` extension", () => {
    const result = extractor.resolveImportPath("./Card.jsx", "src/App.jsx");
    expect(result).toEqual(["src/Card.jsx"]);
  });

  it("normalizes Windows-style paths to posix", () => {
    const result = extractor.resolveImportPath("./Card", "src\\App.js");
    expect(result).toContain("src/Card.js");
  });
});
