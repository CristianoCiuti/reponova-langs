/**
 * Fixture-based tests covering the simple / medium / complex tiers laid out in
 * INTEGRATION-PLAN.md section 8.7. These complement the inline-source tests in
 * `extractor.test.ts` and use real Python files on disk so that we can rely
 * on the same grammar + extractor combination that consumers will hit.
 *
 * The complex/ tier is a verbatim snapshot of `pallets/click` 8.4.1 — see
 * `tests/fixtures/complex/click-8.4.1/ATTRIBUTION.md` for provenance.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { SyntaxTree } from "reponova";
import { plugin, PythonExtractor } from "../src/index.js";
import { loadFixture, loadGrammar } from "@reponova/lang-test-utils";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clickRoot = resolve(packageRoot, "tests/fixtures/complex/click-8.4.1");

async function parse(source: string): Promise<SyntaxTree> {
  const loaded = await loadGrammar(plugin.grammarPath!);
  if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");
  return loaded.parse(source) as SyntaxTree;
}

function walkPyFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith(".py")) {
        out.push(abs);
      }
    }
  }
  return out.sort();
}

describe("simple/cli.py fixture", () => {
  it("extracts the expected functions, class, methods, and constants", async () => {
    const source = loadFixture(packageRoot, "simple/cli.py");
    const tree = await parse(source);
    const result = new PythonExtractor().extract(tree, source, "simple/cli.py");

    const symNames = result.symbols.map((s) => s.name);
    expect(symNames).toContain("parse_args");
    expect(symNames).toContain("Greeter");
    expect(symNames).toContain("greet");
    expect(symNames).toContain("__init__");
    expect(symNames).toContain("main");
    expect(symNames).toContain("DEFAULT_TIMEOUT_SEC");
    expect(symNames).toContain("MAX_RETRIES");

    const greeter = result.symbols.find((s) => s.name === "Greeter" && s.kind === "class");
    expect(greeter?.docstring).toBe("Stateful greeter that remembers a prefix.");

    const importedModules = result.imports.map((i) => i.module);
    expect(importedModules).toContain("argparse");
    expect(importedModules).toContain("sys");
    expect(importedModules).toContain("pathlib");
  });
});

describe("medium/cache.py fixture", () => {
  it("captures dataclass + ABC + decorators + async + __all__", async () => {
    const source = loadFixture(packageRoot, "medium/cache.py");
    const tree = await parse(source);
    const result = new PythonExtractor().extract(tree, source, "medium/cache.py");

    const stats = result.symbols.find((s) => s.name === "Stats" && s.kind === "class");
    expect(stats).toBeDefined();
    expect(stats?.docstring).toBe("Hit / miss counters for diagnostics.");

    // Plain identifier bases ARE extracted (`ABC` here).
    const cacheClass = result.symbols.find((s) => s.name === "Cache" && s.kind === "class");
    expect(cacheClass?.bases).toContain("ABC");

    // The class is recognised, even though its parameterised bases
    // (`Cache[K, V]`, `Generic[K, V]`) are not — see the "known limitation"
    // note below.
    const inMem = result.symbols.find((s) => s.name === "InMemoryCache");
    expect(inMem).toBeDefined();
    expect(inMem?.kind).toBe("class");

    const facade = result.symbols.find((s) => s.name === "AsyncCacheFacade");
    expect(facade).toBeDefined();
    expect(facade?.kind).toBe("class");

    const factory = result.symbols.find((s) => s.name === "make_default_cache" && s.kind === "function");
    expect(factory).toBeDefined();

    expect(result.exports).toEqual(
      expect.arrayContaining(["Cache", "InMemoryCache", "AsyncCacheFacade", "cached", "Stats"]),
    );

    const importedModules = result.imports.map((i) => i.module);
    expect(importedModules).toContain("asyncio");
    expect(importedModules).toContain("abc");
    expect(importedModules).toContain("dataclasses");
    expect(importedModules).toContain("typing");
  });

  it("known limitation: subscripted generic bases (`Cache[K, V]`) are not yet captured", async () => {
    // The current Python extractor only records bases whose AST node type
    // is `identifier`, `dotted_name`, or `attribute`. Subscript expressions
    // like `Cache[K, V]` or `Generic[K, V]` are skipped. This test pins
    // the current behaviour so a future enhancement can flip it.
    const source = loadFixture(packageRoot, "medium/cache.py");
    const tree = await parse(source);
    const result = new PythonExtractor().extract(tree, source, "medium/cache.py");

    const inMem = result.symbols.find((s) => s.name === "InMemoryCache");
    expect(inMem?.bases ?? []).toEqual([]);

    const facade = result.symbols.find((s) => s.name === "AsyncCacheFacade");
    expect(facade?.bases ?? []).toEqual([]);
  });
});

describe("complex fixture: click 8.4.1", () => {
  it("parses every snapshot file and emits non-empty extraction output", async () => {
    const loaded = await loadGrammar(plugin.grammarPath!);
    if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");

    const files = walkPyFiles(join(clickRoot, "src/click"));
    expect(files.length).toBe(17);

    let totalSymbols = 0;
    let totalImports = 0;
    let totalReferences = 0;

    for (const abs of files) {
      const rel = relative(clickRoot, abs).split(sep).join("/");
      const source = readFileSync(abs, "utf8");
      const tree = loaded.parse(source) as SyntaxTree;
      const result = new PythonExtractor().extract(tree, source, rel);

      // click's __init__.py is a re-export hub; everything else has real defs.
      if (rel.endsWith("__init__.py")) {
        expect(result.imports.length, `${rel}: expected imports`).toBeGreaterThan(0);
      } else {
        expect(result.symbols.length, `${rel}: expected symbols`).toBeGreaterThan(0);
      }
      totalSymbols += result.symbols.length;
      totalImports += result.imports.length;
      totalReferences += result.references.length;
    }

    expect(totalSymbols).toBeGreaterThan(300);
    expect(totalImports).toBeGreaterThan(40);
    expect(totalReferences).toBeGreaterThan(50);
  });

  it("extracts landmark click classes from src/click/core.py", async () => {
    const loaded = await loadGrammar(plugin.grammarPath!);
    if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");

    const source = readFileSync(join(clickRoot, "src/click/core.py"), "utf8");
    const tree = loaded.parse(source) as SyntaxTree;
    const result = new PythonExtractor().extract(tree, source, "src/click/core.py");

    const classNames = result.symbols.filter((s) => s.kind === "class").map((s) => s.name);
    for (const landmark of ["Context", "Parameter", "Option", "Argument", "Command", "Group"]) {
      expect(classNames, `expected class ${landmark} in core.py`).toContain(landmark);
    }
  });

  it("captures exception hierarchy in src/click/exceptions.py", async () => {
    const loaded = await loadGrammar(plugin.grammarPath!);
    if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");

    const source = readFileSync(join(clickRoot, "src/click/exceptions.py"), "utf8");
    const tree = loaded.parse(source) as SyntaxTree;
    const result = new PythonExtractor().extract(tree, source, "src/click/exceptions.py");

    const classNames = result.symbols.filter((s) => s.kind === "class").map((s) => s.name);
    expect(classNames).toContain("ClickException");
    expect(classNames).toContain("UsageError");

    const usage = result.symbols.find((s) => s.name === "UsageError");
    expect(usage?.bases).toContain("ClickException");
  });
});
