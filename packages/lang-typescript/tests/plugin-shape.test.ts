/**
 * Smoke test: verifies that `@reponova/lang-typescript` exports a well-formed
 * `LanguagePlugin` and that the wired-up extractor uses the expected
 * TypeScript-flavor configuration. The actual extraction logic is exercised
 * by the test suite in `@reponova/lang-typescript-core`.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { plugin, TypescriptExtractor } from "../src/index.js";

describe("@reponova/lang-typescript plugin shape", () => {
  it("exposes the expected plugin manifest", () => {
    expect(plugin.id).toBe("typescript");
    expect(plugin.extensions).toEqual([".ts", ".mts", ".cts"]);
    expect(plugin.fileType).toBe("typescript");
    expect(plugin.grammarPath).toBeDefined();
    expect(plugin.extractor).toBeInstanceOf(TypescriptExtractor);
    expect(plugin.outline).toBeDefined();
  });

  it("ships the typescript wasm grammar in the package", () => {
    expect(plugin.grammarPath).toMatch(/tree-sitter-typescript\.wasm$/);
    expect(existsSync(plugin.grammarPath!)).toBe(true);
  });

  it("instantiates the extractor with TypeScript defaults", () => {
    const ext = plugin.extractor as TypescriptExtractor;
    expect(ext.languageId).toBe("typescript");
    expect(ext.extensions).toEqual([".ts", ".mts", ".cts"]);
    expect(ext.wasmFile).toBe("tree-sitter-typescript.wasm");
  });

  it("wires the outline to the typescript wasm grammar", () => {
    expect(plugin.outline?.wasmFile).toBe("tree-sitter-typescript.wasm");
    expect(typeof plugin.outline?.treeSitterExtract).toBe("function");
    expect(typeof plugin.outline?.regexExtract).toBe("function");
  });
});
