import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonExtractor, plugin } from "../src/index.js";

function readManifestExtensions(): string[] {
  const pkgJsonPath = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "package.json",
  );
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  return pkg.reponova?.extensions ?? [];
}

describe("@reponova/lang-json plugin shape", () => {
  it("exports the canonical LanguagePlugin envelope", () => {
    expect(plugin.id).toBe("json");
    expect(plugin.fileType).toBe("json");
    expect(plugin.extractor).toBeInstanceOf(JsonExtractor);
    expect(plugin.grammarPath).toBeUndefined();
    expect(plugin.outline).toBeUndefined();
  });

  it("declares extensions in its manifest (authoritative source)", () => {
    expect(readManifestExtensions()).toEqual([".json", ".jsonc"]);
  });

  it("default export is the same singleton as the named one", async () => {
    const mod = await import("../src/index.js");
    expect(mod.default).toBe(plugin);
  });

  it("extractor advertises the right metadata", () => {
    const ext = new JsonExtractor();
    expect(ext.languageId).toBe("json");
    expect(ext.extensions).toEqual([".json", ".jsonc"]);
    expect(ext.wasmFile).toBeUndefined();
  });
});
