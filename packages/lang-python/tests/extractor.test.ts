import { describe, it, expect } from "vitest";
import { plugin, PythonExtractor } from "../src/index.js";

describe("@reponova/lang-python plugin", () => {
  it("exports a valid LanguagePlugin", () => {
    expect(plugin.id).toBe("python");
    expect(plugin.extensions).toEqual([".py", ".pyw"]);
    expect(plugin.grammarPath).toBeDefined();
    expect(plugin.extractor).toBeInstanceOf(PythonExtractor);
    expect(plugin.outline).toBeDefined();
  });

  it("extractor has correct metadata", () => {
    const ext = new PythonExtractor();
    expect(ext.languageId).toBe("python");
    expect(ext.extensions).toEqual([".py", ".pyw"]);
    expect(ext.wasmFile).toBe("tree-sitter-python.wasm");
  });

  it("resolveImportPath handles absolute imports", () => {
    const ext = new PythonExtractor();
    const paths = ext.resolveImportPath("config.loader", "pkg/main.py");
    expect(paths).toContain("config/loader.py");
    expect(paths).toContain("config/loader/__init__.py");
  });

  it("resolveImportPath handles relative imports", () => {
    const ext = new PythonExtractor();
    const paths = ext.resolveImportPath(".utils", "pkg/sub/module.py");
    expect(paths).toContain("pkg/sub/utils.py");
    expect(paths).toContain("pkg/sub/utils/__init__.py");
  });

  it("resolveImportPath handles double-dot relative", () => {
    const ext = new PythonExtractor();
    const paths = ext.resolveImportPath("..config", "pkg/sub/module.py");
    expect(paths).toContain("pkg/config.py");
    expect(paths).toContain("pkg/config/__init__.py");
  });
});

describe("PythonExtractor.extract (requires tree-sitter)", () => {
  // These tests need the real tree-sitter parser + wasm grammar
  let parse: typeof import("reponova")["parse"] | undefined;

  // Try to import the parser; skip tests if web-tree-sitter not available
  it("should parse and extract a simple function", async () => {
    const { parse: parseFn } = await import("reponova/dist/index.js") as any;

    // If parse isn't exported, use direct approach
    const wts = await import("web-tree-sitter");
    const Parser = (wts as any).default ?? (wts as any).Parser;
    await Parser.init();
    const Language = (wts as any).Language ?? Parser.Language;

    const lang = await Language.load(plugin.grammarPath!);
    const parser = new Parser();
    parser.setLanguage(lang);

    const source = `
def greet(name: str) -> str:
    """Say hello."""
    return f"Hello, {name}"

class Greeter:
    """A greeting class."""
    def __init__(self, prefix: str):
        self.prefix = prefix

    def greet(self, name: str) -> str:
        return f"{self.prefix} {name}"
`;

    const tree = parser.parse(source);
    const ext = new PythonExtractor();
    const result = ext.extract(tree, source, "pkg/hello.py");

    expect(result.language).toBe("python");
    expect(result.fileNode.kind).toBe("module");
    expect(result.fileNode.label).toBe("hello.py");

    const funcNames = result.symbols.filter(s => s.kind === "function").map(s => s.name);
    expect(funcNames).toContain("greet");

    const classNames = result.symbols.filter(s => s.kind === "class").map(s => s.name);
    expect(classNames).toContain("Greeter");

    const methods = result.symbols.filter(s => s.kind === "method").map(s => s.name);
    expect(methods).toContain("__init__");
    expect(methods).toContain("greet");

    // Check docstring extraction
    const greetFunc = result.symbols.find(s => s.name === "greet" && s.kind === "function");
    expect(greetFunc?.docstring).toBe("Say hello.");

    const greeterClass = result.symbols.find(s => s.name === "Greeter");
    expect(greeterClass?.docstring).toBe("A greeting class.");
    expect(greeterClass?.bases).toEqual([]);
  });

  it("should extract imports", async () => {
    const wts = await import("web-tree-sitter");
    const Parser = (wts as any).default ?? (wts as any).Parser;
    await Parser.init();
    const Language = (wts as any).Language ?? Parser.Language;
    const lang = await Language.load(plugin.grammarPath!);
    const parser = new Parser();
    parser.setLanguage(lang);

    const source = `import os\nfrom pathlib import Path\nfrom . import utils`;
    const tree = parser.parse(source);
    const ext = new PythonExtractor();
    const result = ext.extract(tree, source, "pkg/mod.py");

    expect(result.imports.length).toBe(3);
    expect(result.imports[0]!.module).toBe("os");
    expect(result.imports[1]!.module).toBe("pathlib");
    expect(result.imports[1]!.names).toContain("Path");
  });

  it("should extract constants", async () => {
    const wts = await import("web-tree-sitter");
    const Parser = (wts as any).default ?? (wts as any).Parser;
    await Parser.init();
    const Language = (wts as any).Language ?? Parser.Language;
    const lang = await Language.load(plugin.grammarPath!);
    const parser = new Parser();
    parser.setLanguage(lang);

    const source = `MAX_RETRIES = 3\nDEFAULT_TIMEOUT = 30\nlower_case = "skip"`;
    const tree = parser.parse(source);
    const ext = new PythonExtractor();
    const result = ext.extract(tree, source, "config.py");

    const constants = result.symbols.filter(s => s.kind === "constant").map(s => s.name);
    expect(constants).toContain("MAX_RETRIES");
    expect(constants).toContain("DEFAULT_TIMEOUT");
    expect(constants).not.toContain("lower_case");
  });

  it("should extract __all__ as exports", async () => {
    const wts = await import("web-tree-sitter");
    const Parser = (wts as any).default ?? (wts as any).Parser;
    await Parser.init();
    const Language = (wts as any).Language ?? Parser.Language;
    const lang = await Language.load(plugin.grammarPath!);
    const parser = new Parser();
    parser.setLanguage(lang);

    const source = `__all__ = ["foo", "bar"]\ndef foo(): pass\ndef bar(): pass\ndef _private(): pass`;
    const tree = parser.parse(source);
    const ext = new PythonExtractor();
    const result = ext.extract(tree, source, "mod.py");

    expect(result.exports).toEqual(["foo", "bar"]);
  });

  it("should mark __init__.py imports as exports", async () => {
    const wts = await import("web-tree-sitter");
    const Parser = (wts as any).default ?? (wts as any).Parser;
    await Parser.init();
    const Language = (wts as any).Language ?? Parser.Language;
    const lang = await Language.load(plugin.grammarPath!);
    const parser = new Parser();
    parser.setLanguage(lang);

    const source = `from .module import SomeClass`;
    const tree = parser.parse(source);
    const ext = new PythonExtractor();
    const result = ext.extract(tree, source, "pkg/__init__.py");

    expect(result.imports[0]!.isExport).toBe(true);
  });

  it("should extract inheritance and references", async () => {
    const wts = await import("web-tree-sitter");
    const Parser = (wts as any).default ?? (wts as any).Parser;
    await Parser.init();
    const Language = (wts as any).Language ?? Parser.Language;
    const lang = await Language.load(plugin.grammarPath!);
    const parser = new Parser();
    parser.setLanguage(lang);

    const source = `class Animal:\n    pass\n\nclass Dog(Animal):\n    def bark(self):\n        print("woof")`;
    const tree = parser.parse(source);
    const ext = new PythonExtractor();
    const result = ext.extract(tree, source, "animals.py");

    const dog = result.symbols.find(s => s.name === "Dog");
    expect(dog?.bases).toContain("Animal");

    const extendsRef = result.references.find(r => r.kind === "extends" && r.name === "Animal");
    expect(extendsRef).toBeDefined();

    const callRef = result.references.find(r => r.kind === "calls" && r.name === "print");
    expect(callRef).toBeDefined();
  });
});
