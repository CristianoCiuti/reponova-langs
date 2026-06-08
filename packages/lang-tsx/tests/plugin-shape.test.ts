/**
 * Smoke test: verifies that `@reponova/lang-tsx` exports a well-formed
 * `LanguagePlugin` and that the wired-up extractor uses the expected
 * TSX-flavor configuration (TSX wasm grammar, `.tsx` extension only,
 * widened resolve candidates that include both `.tsx` and `.ts`).
 *
 * The actual extraction logic — which is shared with `@reponova/lang-typescript`
 * — is exercised by the test suite in `@reponova/lang-typescript-core`.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { plugin, TypescriptExtractor } from "../src/index.js";

function readManifestExtensions(): string[] {
  const pkgJsonPath = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "package.json",
  );
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  return pkg.reponova?.extensions ?? [];
}

describe("@reponova/lang-tsx plugin shape", () => {
  it("exposes the expected plugin manifest", () => {
    expect(plugin.id).toBe("tsx");
    expect(plugin.fileType).toBe("tsx");
    expect(plugin.grammarPath).toBeDefined();
    expect(plugin.extractor).toBeInstanceOf(TypescriptExtractor);
    expect(plugin.outline).toBeDefined();
  });

  it("declares extensions in its manifest (authoritative source)", () => {
    expect(readManifestExtensions()).toEqual([".tsx"]);
  });

  it("ships the tsx wasm grammar in the package", () => {
    expect(plugin.grammarPath).toMatch(/tree-sitter-tsx\.wasm$/);
    expect(existsSync(plugin.grammarPath!)).toBe(true);
  });

  it("instantiates the extractor with TSX defaults", () => {
    const ext = plugin.extractor as TypescriptExtractor;
    expect(ext.languageId).toBe("tsx");
    expect(ext.extensions).toEqual([".tsx"]);
    expect(ext.wasmFile).toBe("tree-sitter-tsx.wasm");
  });

  it("widens import resolution to include both .tsx and .ts candidates", () => {
    const ext = plugin.extractor as TypescriptExtractor;
    const result = ext.resolveImportPath("./foo", "src/App.tsx");
    expect(result).toContain("src/foo.tsx");
    expect(result).toContain("src/foo.ts");
    expect(result).toContain("src/foo.d.ts");
    expect(result).toContain("src/foo/index.tsx");
    expect(result).toContain("src/foo/index.ts");
  });

  it("orders .tsx ahead of .ts when both could match", () => {
    const ext = plugin.extractor as TypescriptExtractor;
    const candidates = ext.resolveImportPath("./Card", "src/App.tsx");
    const tsxIdx = candidates.indexOf("src/Card.tsx");
    const tsIdx = candidates.indexOf("src/Card.ts");
    expect(tsxIdx).toBeGreaterThanOrEqual(0);
    expect(tsIdx).toBeGreaterThan(tsxIdx);
  });

  it("returns an empty array for bare specifiers (npm packages)", () => {
    const ext = plugin.extractor as TypescriptExtractor;
    expect(ext.resolveImportPath("react", "src/App.tsx")).toEqual([]);
    expect(ext.resolveImportPath("next/image", "src/page.tsx")).toEqual([]);
    expect(ext.resolveImportPath("@reponova/lang-tsx", "src/App.tsx")).toEqual(
      [],
    );
  });

  it("wires the outline to the tsx wasm grammar", () => {
    expect(plugin.outline?.wasmFile).toBe("tree-sitter-tsx.wasm");
    expect(typeof plugin.outline?.treeSitterExtract).toBe("function");
    expect(typeof plugin.outline?.regexExtract).toBe("function");
  });
});
