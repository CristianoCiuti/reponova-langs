/**
 * Plugin-shape smoke test for `@reponova/lang-c`.
 *
 * The substantive extraction tests live in `@reponova/lang-c-core`
 * (which both `lang-c` and `lang-cpp` depend on). Here we only verify
 * that the published plugin object satisfies the `LanguagePlugin`
 * contract: correct `id`, manifest extensions, a resolvable
 * `grammarPath`, a working `extractor`, and an `outline`.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { plugin, CFamilyExtractor } from "../src/index.js";

function readManifest(): { reponova?: { extensions?: string[]; id?: string } } {
  const pkgJsonPath = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "package.json",
  );
  return JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
}

describe("@reponova/lang-c plugin shape", () => {
  it("exports a LanguagePlugin with id 'c'", () => {
    expect(plugin.id).toBe("c");
    expect(plugin.fileType).toBe("c");
  });

  it("wires the extractor to a CFamilyExtractor instance configured for C", () => {
    expect(plugin.extractor).toBeInstanceOf(CFamilyExtractor);
    expect(plugin.extractor.languageId).toBe("c");
    expect(plugin.extractor.extensions).toEqual([".c", ".h"]);
    expect(plugin.extractor.wasmFile).toBe("tree-sitter-c.wasm");
  });

  it("declares an outline implementation bound to tree-sitter-c.wasm", () => {
    expect(plugin.outline).toBeDefined();
    expect(plugin.outline?.wasmFile).toBe("tree-sitter-c.wasm");
  });

  it("declares matching extensions in package.json (authoritative source)", () => {
    const manifest = readManifest();
    expect(manifest.reponova?.id).toBe("c");
    expect(manifest.reponova?.extensions).toEqual([".c", ".h"]);
  });

  it("ships a grammar path resolvable inside the workspace after grammar-fetch", () => {
    expect(plugin.grammarPath).toBeDefined();
    // The grammar is fetched by the `pretest` hook before this test runs.
    expect(existsSync(plugin.grammarPath!)).toBe(true);
  });
});
