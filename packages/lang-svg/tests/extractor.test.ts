import { describe, it, expect } from "vitest";
import { plugin, SvgExtractor } from "../src/index.js";

describe("@reponova/lang-svg plugin", () => {
  it("exports a valid LanguagePlugin", () => {
    expect(plugin.id).toBe("svg");
    expect(plugin.extensions).toEqual([".svg"]);
    expect(plugin.grammarPath).toBeUndefined();
    expect(plugin.extractor).toBeInstanceOf(SvgExtractor);
    expect(plugin.outline).toBeUndefined();
  });

  it("extractor has correct metadata", () => {
    const ext = new SvgExtractor();
    expect(ext.languageId).toBe("svg");
    expect(ext.extensions).toEqual([".svg"]);
    expect(ext.wasmFile).toBeUndefined();
  });

  it("resolveImportPath always returns empty", () => {
    const ext = new SvgExtractor();
    expect(ext.resolveImportPath("anything", "file.svg")).toEqual([]);
  });
});

describe("SvgExtractor.extract", () => {
  const ext = new SvgExtractor();

  it("should extract text elements", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg">
      <title>Architecture Diagram</title>
      <text x="10" y="20">ConfigLoader</text>
      <text x="10" y="40">DataProcessor</text>
      <text x="10" y="60">OutputManager</text>
    </svg>`;

    const result = ext.extract(null, source, "docs/flow.svg");

    expect(result.language).toBe("diagram");
    expect(result.fileNode.kind).toBe("diagram");
    expect(result.fileNode.tags).toContain("svg");
    expect(result.fileNode.docstring).toBe("Architecture Diagram");

    const sections = result.symbols.filter(s => s.kind === "section");
    const names = sections.map(s => s.name);
    expect(names).toContain("ConfigLoader");
    expect(names).toContain("DataProcessor");
    expect(names).toContain("OutputManager");
  });

  it("should filter short text (< 3 chars)", () => {
    const source = `<svg><text>AB</text><text>Hello World</text></svg>`;
    const result = ext.extract(null, source, "test.svg");
    const names = result.symbols.map(s => s.name);
    expect(names).not.toContain("AB");
    expect(names).toContain("Hello_World");
  });

  it("should filter pure numeric text", () => {
    const source = `<svg><text>123</text><text>Node Label</text></svg>`;
    const result = ext.extract(null, source, "test.svg");
    const names = result.symbols.map(s => s.name);
    expect(names).toContain("Node_Label");
    // 123 is filtered (pure digits)
    expect(result.symbols.length).toBe(1);
  });

  it("should limit to 20 unique texts", () => {
    const texts = Array.from({ length: 30 }, (_, i) => `<text>Element${i}</text>`).join("");
    const source = `<svg>${texts}</svg>`;
    const result = ext.extract(null, source, "big.svg");
    expect(result.symbols.length).toBeLessThanOrEqual(20);
  });

  it("should handle empty SVG", () => {
    const result = ext.extract(null, "<svg></svg>", "empty.svg");
    expect(result.symbols).toHaveLength(0);
    expect(result.fileNode.kind).toBe("diagram");
  });

  it("should handle SVG without title", () => {
    const source = `<svg><text>Some Text</text></svg>`;
    const result = ext.extract(null, source, "notitle.svg");
    expect(result.fileNode.docstring).toBeUndefined();
  });

  it("should deduplicate text elements", () => {
    const source = `<svg><text>Same</text><text>Same</text><text>Same</text></svg>`;
    const result = ext.extract(null, source, "dup.svg");
    // Deduplicates before creating symbols
    expect(result.symbols.length).toBe(1);
  });

  it("should compute qualifiedName from file path", () => {
    const source = `<svg><text>MyComponent</text></svg>`;
    const result = ext.extract(null, source, "docs/ui/diagram.svg");
    const sym = result.symbols[0];
    expect(sym?.qualifiedName).toBe("docs.ui.diagram.MyComponent");
  });
});
