import { describe, expect, it } from "vitest";
import { MermaidExtractor } from "../src/extractor.js";

/**
 * Mermaid files do not reference each other. The extractor's
 * `resolveImportPath` is therefore a hard no-op — it always returns an
 * empty array, regardless of the module name or current file. This test
 * documents that contract.
 */
describe("MermaidExtractor.resolveImportPath", () => {
  const ext = new MermaidExtractor();

  it.each([
    ["./neighbour.mmd", "src/foo.mmd"],
    ["../parent.mmd", "src/sub/foo.mmd"],
    ["@reponova/some-pkg", "anywhere.mmd"],
    ["", ""],
    ["just-a-name", "x.mmd"],
  ])("returns [] for %s from %s", (mod, current) => {
    expect(ext.resolveImportPath(mod, current)).toEqual([]);
  });
});
