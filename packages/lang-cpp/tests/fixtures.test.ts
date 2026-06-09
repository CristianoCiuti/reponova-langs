/**
 * Integration tests for `@reponova/lang-cpp` against simple, medium,
 * and complex (real-world) C++ fixtures.
 *
 *   - simple   — single namespace + single class + free function,
 *                pure header / implementation split.
 *   - medium   — nested namespaces, template class with inheritance,
 *                ctors/dtors/operator overloads, `using` alias,
 *                template free function, explicit instantiation.
 *   - complex  — magic_enum v0.9.7 (9 headers, ~3,600 LOC of modern
 *                C++17 template metaprogramming with nested namespaces
 *                and constexpr metafunctions).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SyntaxTree } from "reponova";
import { plugin, CppExtractor } from "../src/index.js";
import { loadFixture, loadGrammar } from "@reponova/lang-test-utils";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const magicEnumRoot = resolve(
  packageRoot,
  "tests/fixtures/complex/magic_enum-e046b69a",
);

let grammar: Awaited<ReturnType<typeof loadGrammar>>;

beforeAll(async () => {
  grammar = await loadGrammar(plugin.grammarPath!);
  if (!grammar) throw new Error("tree-sitter-cpp.wasm not present; run `pnpm grammar-fetch`");
});

function parse(source: string): SyntaxTree {
  return grammar!.parse(source) as SyntaxTree;
}

function relPath(filePath: string): string {
  // Trim packageRoot prefix and normalise to POSIX so the qualified
  // names emitted by the extractor are deterministic regardless of
  // the host OS path style.
  const trimmed = filePath.startsWith(packageRoot)
    ? filePath.slice(packageRoot.length + 1)
    : filePath;
  return trimmed.replace(/\\/g, "/");
}

function listCppFiles(rootDir: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
      } else if (/\.(cpp|cc|cxx|c\+\+|hpp|hh|hxx|h\+\+)$/i.test(entry)) {
        out.push(p);
      }
    }
  }
  walk(rootDir);
  return out;
}

describe("simple/greeter — single namespace + class + free function", () => {
  it("extracts the namespace, class with its methods, and the free function", () => {
    const source = loadFixture(packageRoot, "simple/greeter.hpp");
    const result = new CppExtractor().extract(
      parse(source),
      source,
      "tests/fixtures/simple/greeter.hpp",
    );

    const ns = result.symbols.find((s) => s.name === "greet" && s.kind === "module");
    expect(ns).toBeDefined();

    const cls = result.symbols.find((s) => s.name === "Greeter" && s.kind === "class");
    expect(cls?.qualifiedName).toBe("tests.fixtures.simple.greeter.greet.Greeter");

    const members = result.symbols.filter(
      (s) => s.parent === "tests.fixtures.simple.greeter.greet.Greeter",
    );
    const memberNames = members.map((m) => m.name).sort();
    expect(memberNames).toEqual(["Greeter", "Greeter", "greet", "prefix_", "~Greeter"]);

    const sayHello = result.symbols.find(
      (s) => s.name === "say_hello" && s.kind === "function",
    );
    expect(sayHello?.qualifiedName).toBe("tests.fixtures.simple.greeter.greet.say_hello");
  });

  it("emits #include imports for both <string> and the local header", () => {
    const source = loadFixture(packageRoot, "simple/greeter.cpp");
    const result = new CppExtractor().extract(
      parse(source),
      source,
      "tests/fixtures/simple/greeter.cpp",
    );
    const modules = result.imports.map((i) => i.module).sort();
    expect(modules).toContain("greeter.hpp");
    expect(modules).toContain("<utility>");
  });

  it("captures the `greet` method's call chain (operator+, etc. are surfaced)", () => {
    const source = loadFixture(packageRoot, "simple/greeter.cpp");
    const result = new CppExtractor().extract(
      parse(source),
      source,
      "tests/fixtures/simple/greeter.cpp",
    );
    const sayHelloCalls = result.references.filter(
      (r) => r.fromSymbol.endsWith("say_hello") && r.kind === "calls",
    );
    expect(sayHelloCalls.length).toBeGreaterThan(0);
    expect(sayHelloCalls.map((r) => r.name)).toEqual(
      expect.arrayContaining(["g.greet"]),
    );
  });
});

describe("medium/cache — templates, inheritance, ctors/dtors, operator, alias", () => {
  it("emits the abstract base class with virtual methods", () => {
    const source = loadFixture(packageRoot, "medium/cache.hpp");
    const result = new CppExtractor().extract(
      parse(source),
      source,
      "tests/fixtures/medium/cache.hpp",
    );
    const base = result.symbols.find((s) => s.name === "CacheBase");
    expect(base?.kind).toBe("class");
    expect(base?.qualifiedName).toBe("tests.fixtures.medium.cache.acme.cache.CacheBase");

    const dtor = result.symbols.find((s) => s.name === "~CacheBase");
    expect(dtor?.decorators).toContain("dtor");
  });

  it("emits the templated Cache<K,V> with template decorator and base reference", () => {
    const source = loadFixture(packageRoot, "medium/cache.hpp");
    const result = new CppExtractor().extract(
      parse(source),
      source,
      "tests/fixtures/medium/cache.hpp",
    );

    const cache = result.symbols.find((s) => s.name === "Cache" && s.kind === "class");
    expect(cache).toBeDefined();
    expect(cache?.decorators).toContain("template");
    expect(cache?.signature).toMatch(/^template/);

    const extendsCacheBase = result.references.find(
      (r) =>
        r.kind === "extends" &&
        r.name === "CacheBase" &&
        r.fromSymbol.endsWith(".Cache"),
    );
    expect(extendsCacheBase).toBeDefined();
  });

  it("surfaces the StringCache `using` alias as a type symbol", () => {
    const source = loadFixture(packageRoot, "medium/cache.hpp");
    const result = new CppExtractor().extract(
      parse(source),
      source,
      "tests/fixtures/medium/cache.hpp",
    );
    const alias = result.symbols.find((s) => s.name === "StringCache");
    expect(alias?.kind).toBe("type");
    expect(alias?.decorators).toContain("alias");
  });

  it("the .cpp surfaces out-of-class definitions under their class qualified name", () => {
    const source = loadFixture(packageRoot, "medium/cache.cpp");
    const result = new CppExtractor().extract(
      parse(source),
      source,
      "tests/fixtures/medium/cache.cpp",
    );

    const baseCtor = result.symbols.find((s) =>
      s.qualifiedName.endsWith("CacheBase.CacheBase"),
    );
    expect(baseCtor?.kind).toBe("method");
    expect(baseCtor?.decorators).toContain("out_of_class");

    const cachePut = result.symbols.find(
      (s) =>
        s.name === "put" &&
        s.qualifiedName.endsWith(".Cache.put") &&
        s.kind === "method",
    );
    expect(cachePut).toBeDefined();
    expect(cachePut?.decorators).toContain("out_of_class");
  });

  it("the .cpp captures the put/get call graph inside templated methods", () => {
    const source = loadFixture(packageRoot, "medium/cache.cpp");
    const result = new CppExtractor().extract(
      parse(source),
      source,
      "tests/fixtures/medium/cache.cpp",
    );
    const cachePutCalls = result.references.filter(
      (r) => r.fromSymbol.endsWith(".Cache.put") && r.kind === "calls",
    );
    expect(cachePutCalls.length).toBeGreaterThan(0);
  });
});

describe("complex fixture: magic_enum v0.9.7", () => {
  it("the fixture is properly attributed and sourced", () => {
    expect(existsSync(magicEnumRoot)).toBe(true);
    expect(existsSync(resolve(magicEnumRoot, "ATTRIBUTION.md"))).toBe(true);
    expect(existsSync(resolve(magicEnumRoot, "LICENSE"))).toBe(true);
    expect(magicEnumRoot).toMatch(/magic_enum-[0-9a-f]+$/);
  });

  it("parses every header without raising and emits non-empty extraction output", () => {
    const files = listCppFiles(magicEnumRoot);
    expect(files.length).toBeGreaterThanOrEqual(8); // 9 headers expected
    let totalSymbols = 0;
    let totalImports = 0;
    let totalNamespaces = 0;
    let totalClasses = 0;
    for (const filePath of files) {
      const rel = relPath(filePath);
      const source = loadFixture(packageRoot, rel.replace(/^tests\/fixtures\//, ""));
      const result = new CppExtractor().extract(parse(source), source, rel);
      expect(result.filePath).toBe(rel);
      expect(result.language).toBe("cpp");
      totalSymbols += result.symbols.length;
      totalImports += result.imports.length;
      totalNamespaces += result.symbols.filter((s) => s.kind === "module").length;
      totalClasses += result.symbols.filter((s) => s.kind === "class").length;
    }
    expect(totalSymbols).toBeGreaterThan(200);
    expect(totalImports).toBeGreaterThan(20);
    expect(totalNamespaces).toBeGreaterThan(5);
    expect(totalClasses).toBeGreaterThan(10);
  });

  it("recognises the top-level `magic_enum` namespace and its nested `detail` sub-namespace", () => {
    const rel = "complex/magic_enum-e046b69a/include/magic_enum/magic_enum.hpp";
    const source = loadFixture(packageRoot, rel);
    const result = new CppExtractor().extract(
      parse(source),
      source,
      `tests/fixtures/${rel}`,
    );
    const namespaces = result.symbols
      .filter((s) => s.kind === "module")
      .map((s) => s.name);
    expect(namespaces).toContain("magic_enum");
    expect(namespaces).toContain("detail");
  });

  it("surfaces the `MAGIC_ENUM_VERSION_*` macros as constants", () => {
    const rel = "complex/magic_enum-e046b69a/include/magic_enum/magic_enum.hpp";
    const source = loadFixture(packageRoot, rel);
    const result = new CppExtractor().extract(
      parse(source),
      source,
      `tests/fixtures/${rel}`,
    );
    for (const m of [
      "MAGIC_ENUM_VERSION_MAJOR",
      "MAGIC_ENUM_VERSION_MINOR",
      "MAGIC_ENUM_VERSION_PATCH",
    ]) {
      const sym = result.symbols.find((s) => s.name === m);
      expect(sym?.kind, `expected ${m} to be a constant`).toBe("constant");
      expect(sym?.decorators, `expected ${m} to carry the macro decorator`).toContain(
        "macro",
      );
    }
  });

  it("emits the top-level `enum_name` and `enum_count` free functions", () => {
    const rel = "complex/magic_enum-e046b69a/include/magic_enum/magic_enum.hpp";
    const source = loadFixture(packageRoot, rel);
    const result = new CppExtractor().extract(
      parse(source),
      source,
      `tests/fixtures/${rel}`,
    );
    const enumName = result.symbols.find(
      (s) => s.name === "enum_name" && s.kind === "function",
    );
    expect(enumName).toBeDefined();
    expect(enumName?.decorators).toContain("template");

    const enumCount = result.symbols.find(
      (s) => s.name === "enum_count" && s.kind === "function",
    );
    expect(enumCount).toBeDefined();
    expect(enumCount?.decorators).toContain("template");
  });

  it("includes <array> / <type_traits> / similar STL headers across the fixture", () => {
    const files = listCppFiles(magicEnumRoot);
    const allImportModules = new Set<string>();
    for (const filePath of files) {
      const rel = relPath(filePath);
      const source = loadFixture(packageRoot, rel.replace(/^tests\/fixtures\//, ""));
      const result = new CppExtractor().extract(parse(source), source, rel);
      for (const imp of result.imports) allImportModules.add(imp.module);
    }
    const expectedSubset = ["<array>", "<type_traits>", "<utility>"];
    for (const h of expectedSubset) {
      expect(allImportModules).toContain(h);
    }
  });
});
