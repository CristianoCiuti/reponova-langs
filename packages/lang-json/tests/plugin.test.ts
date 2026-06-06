import { describe, expect, it } from "vitest";
import { JsonExtractor, plugin } from "../src/index.js";

describe("@reponova/lang-json plugin shape", () => {
  it("exports the canonical LanguagePlugin envelope", () => {
    expect(plugin.id).toBe("json");
    expect(plugin.extensions).toEqual([".json", ".jsonc"]);
    expect(plugin.fileType).toBe("json");
    expect(plugin.extractor).toBeInstanceOf(JsonExtractor);
    expect(plugin.grammarPath).toBeUndefined();
    expect(plugin.outline).toBeUndefined();
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
