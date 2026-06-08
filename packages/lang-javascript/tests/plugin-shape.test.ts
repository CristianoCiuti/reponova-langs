/**
 * Smoke test: verifies that `@reponova/lang-javascript` exports a well-formed
 * `LanguagePlugin` and that the wired-up extractor uses the expected
 * JavaScript-flavor configuration (JS wasm grammar, the four JS extensions,
 * widened resolve candidates that include every JS dialect we accept).
 *
 * The actual extraction logic — which is shared with `@reponova/lang-typescript`
 * and `@reponova/lang-tsx` — is exercised by the test suite in
 * `@reponova/lang-typescript-core` and by the JS-specific scenarios in
 * `extractor.test.ts`.
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

describe("@reponova/lang-javascript plugin shape", () => {
  it("exposes the expected plugin manifest", () => {
    expect(plugin.id).toBe("javascript");
    expect(plugin.fileType).toBe("javascript");
    expect(plugin.grammarPath).toBeDefined();
    expect(plugin.extractor).toBeInstanceOf(TypescriptExtractor);
    expect(plugin.outline).toBeDefined();
  });

  it("declares extensions in its manifest (authoritative source)", () => {
    expect(readManifestExtensions()).toEqual([".js", ".mjs", ".cjs", ".jsx"]);
  });

  it("ships the JavaScript wasm grammar in the package", () => {
    expect(plugin.grammarPath).toMatch(/tree-sitter-javascript\.wasm$/);
    expect(existsSync(plugin.grammarPath!)).toBe(true);
  });

  it("instantiates the extractor with JavaScript defaults", () => {
    const ext = plugin.extractor as TypescriptExtractor;
    expect(ext.languageId).toBe("javascript");
    expect(ext.extensions).toEqual([".js", ".mjs", ".cjs", ".jsx"]);
    expect(ext.wasmFile).toBe("tree-sitter-javascript.wasm");
  });

  it("widens import resolution to include every JS dialect candidate", () => {
    const ext = plugin.extractor as TypescriptExtractor;
    const result = ext.resolveImportPath("./foo", "src/App.js");
    expect(result).toContain("src/foo.js");
    expect(result).toContain("src/foo.mjs");
    expect(result).toContain("src/foo.cjs");
    expect(result).toContain("src/foo.jsx");
    expect(result).toContain("src/foo/index.js");
    expect(result).toContain("src/foo/index.mjs");
    expect(result).toContain("src/foo/index.cjs");
    expect(result).toContain("src/foo/index.jsx");
  });

  it("orders .js ahead of .mjs/.cjs/.jsx when all could match", () => {
    const ext = plugin.extractor as TypescriptExtractor;
    const candidates = ext.resolveImportPath("./Card", "src/App.js");
    const jsIdx = candidates.indexOf("src/Card.js");
    const mjsIdx = candidates.indexOf("src/Card.mjs");
    const jsxIdx = candidates.indexOf("src/Card.jsx");
    expect(jsIdx).toBeGreaterThanOrEqual(0);
    expect(mjsIdx).toBeGreaterThan(jsIdx);
    expect(jsxIdx).toBeGreaterThan(jsIdx);
  });

  it("returns an empty array for bare specifiers (npm packages)", () => {
    const ext = plugin.extractor as TypescriptExtractor;
    expect(ext.resolveImportPath("react", "src/App.jsx")).toEqual([]);
    expect(ext.resolveImportPath("express", "src/server.js")).toEqual([]);
    expect(ext.resolveImportPath("@reponova/lang-javascript", "src/App.js")).toEqual(
      [],
    );
    expect(ext.resolveImportPath("node:fs/promises", "src/io.js")).toEqual([]);
  });

  it("wires the outline to the JavaScript wasm grammar", () => {
    expect(plugin.outline?.wasmFile).toBe("tree-sitter-javascript.wasm");
    expect(typeof plugin.outline?.treeSitterExtract).toBe("function");
    expect(typeof plugin.outline?.regexExtract).toBe("function");
  });
});
