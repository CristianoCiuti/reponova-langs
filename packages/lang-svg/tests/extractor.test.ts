import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { plugin, SvgExtractor } from "../src/index.js";

function readManifestExtensions(): string[] {
  const pkgJsonPath = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "package.json",
  );
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  return pkg.reponova?.extensions ?? [];
}

describe("@reponova/lang-svg plugin", () => {
  it("exports a valid LanguagePlugin", () => {
    expect(plugin.id).toBe("svg");
    expect(plugin.grammarPath).toBeUndefined();
    expect(plugin.extractor).toBeInstanceOf(SvgExtractor);
    expect(plugin.outline).toBeUndefined();
  });

  it("declares extensions in its manifest (authoritative source)", () => {
    expect(readManifestExtensions()).toEqual([".svg"]);
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

  it("should extract multi-line text bodies and tspan children as a single label", () => {
    // Real-world SVGs (Inkscape, hand-authored, Mermaid output) routinely
    // line-break inside <text> with <tspan>. The previous regex
    // [^<]+ stopped at the first `<` and silently dropped the whole
    // element. The new normaliser collapses tspan whitespace into a
    // single space-separated label.
    const source = `<svg>
      <title>Login Flow Diagram</title>
      <text x="10" y="20">
        <tspan x="10" dy="0">Authentication</tspan>
        <tspan x="10" dy="15">Service</tspan>
      </text>
      <text x="50" y="80">
        Plain
        wrapped
        label
      </text>
    </svg>`;
    const result = ext.extract(null, source, "auth.svg");
    const docstrings = result.symbols.map((s) => s.docstring);
    expect(docstrings).toContain("Authentication Service");
    expect(docstrings).toContain("Plain wrapped label");
    // File docstring also tolerates the multi-line title regex.
    expect(result.fileNode.docstring).toBe("Login Flow Diagram");
  });

  it("should extract <desc> bodies as section symbols", () => {
    // <desc> is the SVG-native long-form description element. Most
    // diagram tooling (e.g. Inkscape, hand-authored architecture
    // diagrams) puts a short label in <title> and a multi-sentence
    // explanation in <desc>; both are user-visible accessibility text
    // and belong in the symbol list.
    const source = `<svg>
      <title>Network Topology</title>
      <desc>Edge router connected to two backbone switches</desc>
      <g>
        <desc>Customer-facing zone</desc>
      </g>
    </svg>`;
    const result = ext.extract(null, source, "net.svg");
    const sources = result.symbols.map((s) => (s.decorators ?? [])[0]);
    const docstrings = result.symbols.map((s) => s.docstring);
    expect(sources).toContain("svg_desc");
    expect(docstrings).toContain("Edge router connected to two backbone switches");
    expect(docstrings).toContain("Customer-facing zone");
  });

  it("should extract aria-label attributes for path-only icons", () => {
    // simple-icons-style SVGs ship a single <path> with all visible
    // text replaced by aria-label. Without aria-label coverage every
    // such icon is a symbol-less diagram in the graph.
    const source = `<svg role="img" aria-label="GitHub">
      <path d="M12 0C5.37..." aria-label="Logo glyph"/>
    </svg>`;
    const result = ext.extract(null, source, "icon.svg");
    const docstrings = result.symbols.map((s) => s.docstring);
    expect(docstrings).toContain("GitHub");
    expect(docstrings).toContain("Logo glyph");
    const sources = result.symbols.map((s) => (s.decorators ?? [])[0]);
    expect(sources).toContain("svg_aria_label");
  });

  it("should decode XML entities in text bodies", () => {
    const source = `<svg><text>R&amp;D Pipeline</text><title>A &lt; B</title></svg>`;
    const result = ext.extract(null, source, "entities.svg");
    const docstrings = result.symbols.map((s) => s.docstring);
    expect(docstrings).toContain("R&D Pipeline");
    expect(result.fileNode.docstring).toBe("A < B");
  });

  it("should classify each label by its source via decorator", () => {
    const source = `<svg aria-label="Diagram Wrapper">
      <title>Top Level</title>
      <text>Body text</text>
      <desc>Description text</desc>
    </svg>`;
    const result = ext.extract(null, source, "src/sources.svg");
    const map = new Map(result.symbols.map((s) => [s.docstring, (s.decorators ?? [])[0]]));
    expect(map.get("Top Level")).toBe("svg_title");
    expect(map.get("Body text")).toBe("svg_text");
    expect(map.get("Description text")).toBe("svg_desc");
    expect(map.get("Diagram Wrapper")).toBe("svg_aria_label");
  });
});
