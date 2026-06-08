import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { plugin, PythonExtractor } from "../src/index.js";
import { python as pythonOutline } from "../src/outline.js";

/**
 * Read `package.json.reponova.extensions` — the single source of truth for
 * what file extensions this plugin claims to handle. Tests pin the manifest
 * directly rather than the runtime export, mirroring how the production
 * loader reads them.
 */
function readManifestExtensions(): string[] {
  const pkgJsonPath = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "package.json",
  );
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  return pkg.reponova?.extensions ?? [];
}

describe("@reponova/lang-python plugin", () => {
  it("exports a valid LanguagePlugin", () => {
    expect(plugin.id).toBe("python");
    expect(plugin.grammarPath).toBeDefined();
    expect(plugin.extractor).toBeInstanceOf(PythonExtractor);
    expect(plugin.outline).toBeDefined();
  });

  it("declares extensions in its manifest (authoritative source)", () => {
    expect(readManifestExtensions()).toEqual([".py", ".pyw"]);
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
  it("should parse and extract a simple function", async () => {
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

  it("should surface imports and declarations inside `if TYPE_CHECKING:` blocks", async () => {
    const wts = await import("web-tree-sitter");
    const Parser = (wts as any).default ?? (wts as any).Parser;
    await Parser.init();
    const Language = (wts as any).Language ?? Parser.Language;
    const lang = await Language.load(plugin.grammarPath!);
    const parser = new Parser();
    parser.setLanguage(lang);

    const source = [
      "from __future__ import annotations",
      "from typing import TYPE_CHECKING",
      "",
      "if TYPE_CHECKING:",
      "    from collections.abc import Mapping",
      "    from .domain import User as DomainUser",
      "",
      "def at_runtime() -> None:",
      "    pass",
      "",
    ].join("\n");
    const tree = parser.parse(source);
    const ext = new PythonExtractor();
    const result = ext.extract(tree, source, "pkg/conditional.py");

    const modules = result.imports.map((i) => i.module);
    expect(modules).toContain("__future__");
    expect(modules).toContain("typing");
    expect(modules).toContain("collections.abc");
    // Relative imports inside TYPE_CHECKING are also surfaced.
    expect(modules.some((m) => m.startsWith("."))).toBe(true);

    const symNames = result.symbols.map((s) => s.name);
    expect(symNames).toContain("at_runtime");
  });

  it("should surface imports inside `try / except ImportError` soft-dependency blocks", async () => {
    const wts = await import("web-tree-sitter");
    const Parser = (wts as any).default ?? (wts as any).Parser;
    await Parser.init();
    const Language = (wts as any).Language ?? Parser.Language;
    const lang = await Language.load(plugin.grammarPath!);
    const parser = new Parser();
    parser.setLanguage(lang);

    const source = [
      "try:",
      "    import tomllib",
      "except ImportError:  # Python < 3.11",
      "    import tomli as tomllib",
      "",
    ].join("\n");
    const tree = parser.parse(source);
    const ext = new PythonExtractor();
    const result = ext.extract(tree, source, "pkg/softdeps.py");

    const modules = result.imports.map((i) => i.module);
    expect(modules).toContain("tomllib");
    expect(modules).toContain("tomli");
  });

  it("should capture TypeVar / NewType / ParamSpec / TypeVarTuple as `type` symbols", async () => {
    const wts = await import("web-tree-sitter");
    const Parser = (wts as any).default ?? (wts as any).Parser;
    await Parser.init();
    const Language = (wts as any).Language ?? Parser.Language;
    const lang = await Language.load(plugin.grammarPath!);
    const parser = new Parser();
    parser.setLanguage(lang);

    const source = [
      "from typing import TypeVar, NewType, ParamSpec, TypeVarTuple",
      "import typing as t",
      "",
      "K = TypeVar('K')",
      "V = t.TypeVar('V')",
      "UserId = NewType('UserId', int)",
      "P = ParamSpec('P')",
      "Ts = TypeVarTuple('Ts')",
      "",
    ].join("\n");
    const tree = parser.parse(source);
    const ext = new PythonExtractor();
    const result = ext.extract(tree, source, "pkg/typevars.py");

    const findKind = (name: string) => result.symbols.find((s) => s.name === name);
    expect(findKind("K")?.kind).toBe("type");
    expect(findKind("K")?.decorators).toEqual(["typevar"]);
    expect(findKind("V")?.kind).toBe("type");
    expect(findKind("V")?.decorators).toEqual(["typevar"]);
    expect(findKind("UserId")?.kind).toBe("type");
    expect(findKind("UserId")?.decorators).toEqual(["newtype"]);
    expect(findKind("P")?.decorators).toEqual(["paramspec"]);
    expect(findKind("Ts")?.decorators).toEqual(["typevartuple"]);
  });

  it("should capture PascalCase = Subscript / Union as type aliases, but not lowercase or subscripted lookups", async () => {
    const wts = await import("web-tree-sitter");
    const Parser = (wts as any).default ?? (wts as any).Parser;
    await Parser.init();
    const Language = (wts as any).Language ?? Parser.Language;
    const lang = await Language.load(plugin.grammarPath!);
    const parser = new Parser();
    parser.setLanguage(lang);

    const source = [
      "from typing import Dict, List, Union",
      "",
      "User = Dict[str, str]",
      "Ids = list[int]",
      "Maybe = Union[int, None]",
      "Either = int | str",
      "",
      "result = my_dict[key]  # NOT a type alias (lowercase)",
      "MAX_RETRIES = 3        # constant, not alias",
      "",
    ].join("\n");
    const tree = parser.parse(source);
    const ext = new PythonExtractor();
    const result = ext.extract(tree, source, "pkg/aliases.py");

    const find = (name: string) => result.symbols.find((s) => s.name === name);
    expect(find("User")?.kind).toBe("type");
    expect(find("User")?.decorators).toEqual(["alias"]);
    expect(find("Ids")?.kind).toBe("type");
    expect(find("Maybe")?.kind).toBe("type");
    expect(find("Either")?.kind).toBe("type");

    // Lowercase RHS = subscript should NOT promote to type.
    expect(find("result")).toBeUndefined();
    // Constants stay constants.
    expect(find("MAX_RETRIES")?.kind).toBe("constant");
  });

  it("should mark async functions with the `async` decorator", async () => {
    const wts = await import("web-tree-sitter");
    const Parser = (wts as any).default ?? (wts as any).Parser;
    await Parser.init();
    const Language = (wts as any).Language ?? Parser.Language;
    const lang = await Language.load(plugin.grammarPath!);
    const parser = new Parser();
    parser.setLanguage(lang);

    const source = [
      "async def fetch(url: str) -> str:",
      "    return ''",
      "",
      "def sync_fn() -> None:",
      "    pass",
      "",
      "class Worker:",
      "    async def run(self) -> None:",
      "        pass",
      "    def stop(self) -> None:",
      "        pass",
      "",
    ].join("\n");
    const tree = parser.parse(source);
    const ext = new PythonExtractor();
    const result = ext.extract(tree, source, "pkg/async_demo.py");

    const fetch = result.symbols.find((s) => s.name === "fetch")!;
    expect(fetch.decorators).toContain("async");
    const sync = result.symbols.find((s) => s.name === "sync_fn")!;
    expect(sync.decorators ?? []).not.toContain("async");

    const run = result.symbols.find((s) => s.name === "run")!;
    expect(run.decorators).toContain("async");
    const stop = result.symbols.find((s) => s.name === "stop")!;
    expect(stop.decorators ?? []).not.toContain("async");
  });

  it("outline pipeline keeps parity with the extractor for subscripted bases and TYPE_CHECKING imports", async () => {
    // The outline tree-sitter pipeline ships separately from the extractor
    // and must surface the same heritage and conditional-import shapes.
    // This regression test pins both invariants so future changes to
    // either side stay in sync.
    const wts = await import("web-tree-sitter");
    const Parser = (wts as any).default ?? (wts as any).Parser;
    await Parser.init();
    const Language = (wts as any).Language ?? Parser.Language;
    const lang = await Language.load(plugin.grammarPath!);
    const parser = new Parser();
    parser.setLanguage(lang);

    const source = [
      "from typing import TYPE_CHECKING, Generic, TypeVar",
      "",
      "if TYPE_CHECKING:",
      "    from collections.abc import Mapping",
      "",
      "K = TypeVar('K')",
      "V = TypeVar('V')",
      "",
      "class Cache(Generic[K, V]):",
      "    pass",
      "",
      "class StrCache(Cache[str, str]):",
      "    pass",
      "",
    ].join("\n");
    const tree = parser.parse(source);
    expect(pythonOutline.treeSitterExtract).toBeDefined();
    const outline = pythonOutline.treeSitterExtract!(tree.rootNode, "pkg/cache.py", source.split("\n").length);

    // Outline surfaces both top-level and conditional-block imports.
    const outlineModules = outline.imports.map((i) => i.module);
    expect(outlineModules).toContain("typing");
    expect(outlineModules).toContain("collections.abc");

    // Outline subscripted bases collapse to bare type names.
    const cache = outline.classes.find((c: { name: string }) => c.name === "Cache");
    expect(cache?.bases).toContain("Generic");
    const strCache = outline.classes.find((c: { name: string }) => c.name === "StrCache");
    expect(strCache?.bases).toContain("Cache");
  });

  it("should unwrap subscripted / dotted bases and ignore keyword arguments", async () => {
    const wts = await import("web-tree-sitter");
    const Parser = (wts as any).default ?? (wts as any).Parser;
    await Parser.init();
    const Language = (wts as any).Language ?? Parser.Language;
    const lang = await Language.load(plugin.grammarPath!);
    const parser = new Parser();
    parser.setLanguage(lang);

    const source = [
      "from typing import Generic, TypeVar",
      "",
      "K = TypeVar('K')",
      "V = TypeVar('V')",
      "",
      "class Box(Generic[K, V]):",
      "    pass",
      "",
      "class StrBox(Box[str, str]):",
      "    pass",
      "",
      "class TypedBox(typing.Generic[K]):",
      "    pass",
      "",
      "class WithMeta(Box[K, V], metaclass=type):",
      "    pass",
      "",
    ].join("\n");
    const tree = parser.parse(source);
    const ext = new PythonExtractor();
    const result = ext.extract(tree, source, "boxes.py");

    const box = result.symbols.find((s) => s.name === "Box");
    expect(box?.bases).toEqual(["Generic"]);

    const strBox = result.symbols.find((s) => s.name === "StrBox");
    expect(strBox?.bases).toEqual(["Box"]);

    const typedBox = result.symbols.find((s) => s.name === "TypedBox");
    expect(typedBox?.bases).toEqual(["typing.Generic"]);

    // `metaclass=type` is a keyword_argument and must NOT leak into `bases`.
    const withMeta = result.symbols.find((s) => s.name === "WithMeta");
    expect(withMeta?.bases).toEqual(["Box"]);

    // Each base also produces an extends-reference now.
    const refsTo = (name: string) =>
      result.references.filter((r) => r.kind === "extends" && r.name === name).length;
    expect(refsTo("Generic")).toBeGreaterThanOrEqual(1);
    expect(refsTo("Box")).toBeGreaterThanOrEqual(2);
    expect(refsTo("typing.Generic")).toBeGreaterThanOrEqual(1);
  });
});
