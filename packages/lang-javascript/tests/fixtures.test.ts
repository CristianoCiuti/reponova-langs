/**
 * Fixture-driven tests for the JavaScript plugin. Loads the simple/medium
 * hand-written fixtures from disk, runs them through the extractor, and
 * asserts on the shape of the resulting graph (symbols, edges, imports).
 * The complex/ tier (OSS Express snapshot) is exercised in
 * `complex.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { plugin } from "../src/index.js";
import { type TypescriptExtractor } from "@reponova/lang-typescript-core";
import { loadFixture, loadGrammar } from "@reponova/lang-test-utils";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SyntaxTree } from "reponova";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extractor = plugin.extractor as TypescriptExtractor;

async function parse(source: string): Promise<SyntaxTree> {
  const loaded = await loadGrammar(plugin.grammarPath!);
  if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");
  return loaded.parse(source) as SyntaxTree;
}

describe("simple/Counter.js", () => {
  it("extracts the function, the arrow constants, and the named export", async () => {
    const source = loadFixture(packageRoot, "simple/Counter.js");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "simple/Counter.js");

    const symbolNames = result.symbols.map((s) => s.name).sort();
    expect(symbolNames).toContain("createCounter");
    expect(symbolNames).toContain("DEFAULT_STEP");
    expect(symbolNames).toContain("makeTicker");

    const counter = result.symbols.find((s) => s.name === "createCounter");
    expect(counter?.kind).toBe("function");
    expect(counter?.docstring).toMatch(/Builds a counter event emitter/);

    const counterCalls = result.references
      .filter((r) => r.kind === "calls" && r.fromSymbol === "simple.Counter.createCounter")
      .map((r) => r.name);
    expect(counterCalls).toContain("EventEmitter");

    expect(result.imports.map((i) => i.module)).toContain("node:events");
    expect(result.exports).toContain("createCounter");
    expect(result.exports).toContain("DEFAULT_STEP");
    expect(result.exports).toContain("makeTicker");
    expect(result.exports).toContain("default");
  });

  it("treats the file node as a JavaScript module", async () => {
    const source = loadFixture(packageRoot, "simple/Counter.js");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "simple/Counter.js");
    expect(result.fileNode.kind).toBe("module");
    expect(result.fileNode.label).toBe("Counter.js");
    expect(result.language).toBe("javascript");
  });
});

describe("medium/Card.jsx", () => {
  it("extracts Card and CompactCard components plus the variants array", async () => {
    const source = loadFixture(packageRoot, "medium/Card.jsx");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "medium/Card.jsx");

    const symbolNames = result.symbols.map((s) => s.name).sort();
    expect(symbolNames).toContain("Card");
    expect(symbolNames).toContain("CompactCard");
    expect(symbolNames).toContain("CARD_VARIANTS");

    const compactCard = result.symbols.find((s) => s.name === "CompactCard");
    expect(compactCard?.kind).toBe("function");
    const compactCalls = result.references
      .filter((r) => r.kind === "calls" && r.fromSymbol === "medium.Card.CompactCard")
      .map((r) => r.name);
    expect(compactCalls).toContain("Card");
    expect(compactCalls).toContain("Fragment");
  });
});

describe("medium/Modal.jsx", () => {
  it("extracts the Modal class with its lifecycle methods and bound handler", async () => {
    const source = loadFixture(packageRoot, "medium/Modal.jsx");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "medium/Modal.jsx");

    const modal = result.symbols.find((s) => s.kind === "class" && s.name === "Modal");
    expect(modal).toBeDefined();
    expect(modal?.bases).toContain("Component");

    const methods = result.symbols
      .filter((s) => s.kind === "method" && s.parent === "Modal")
      .map((s) => s.name)
      .sort();
    expect(methods).toContain("constructor");
    expect(methods).toContain("componentDidMount");
    expect(methods).toContain("componentWillUnmount");
    expect(methods).toContain("handleClose");
    expect(methods).toContain("render");

    const staticField = result.symbols.find(
      (s) => s.kind === "variable" && s.parent === "Modal" && s.name === "defaultProps",
    );
    expect(staticField?.decorators).toContain("static");
  });
});

describe("medium/App.jsx", () => {
  it("extracts the App component, captures hooks and JSX usages, and surfaces re-exports", async () => {
    const source = loadFixture(packageRoot, "medium/App.jsx");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "medium/App.jsx");

    const app = result.symbols.find((s) => s.name === "App");
    expect(app?.kind).toBe("function");

    const appCalls = result.references
      .filter((r) => r.kind === "calls" && r.fromSymbol === "medium.App.App")
      .map((r) => r.name);
    expect(appCalls).toContain("useState");
    expect(appCalls).toContain("useMemo");
    expect(appCalls).toContain("useEffect");
    expect(appCalls).toContain("Fragment");
    expect(appCalls).toContain("Card");
    expect(appCalls).toContain("CompactCard");
    expect(appCalls).toContain("Modal");

    const importedModules = result.imports.map((i) => i.module).sort();
    expect(importedModules).toContain("react");
    expect(importedModules).toContain("./Card.jsx");
    expect(importedModules).toContain("./Modal.jsx");

    const reExports = result.imports.filter((i) => i.isExport);
    const reModules = reExports.map((i) => i.module).sort();
    expect(reModules).toContain("./Card.jsx");
    expect(reModules).toContain("./Modal.jsx");

    expect(result.exports).toContain("App");
    expect(result.exports).toContain("default");
  });
});

describe("medium/legacy-config.cjs", () => {
  it("extracts CommonJS functions and surfaces require() imports", async () => {
    const source = loadFixture(packageRoot, "medium/legacy-config.cjs");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "medium/legacy-config.cjs");

    const symbolNames = result.symbols.map((s) => s.name).sort();
    expect(symbolNames).toContain("loadConfig");
    expect(symbolNames).toContain("mergeAll");
    expect(symbolNames).toContain("defineSource");

    const loadCfg = result.symbols.find((s) => s.name === "loadConfig");
    expect(loadCfg?.kind).toBe("function");
    expect(loadCfg?.docstring).toMatch(/Reads a JSON file/);

    const modules = result.imports.map((i) => i.module).sort();
    expect(modules).toContain("node:path");
    expect(modules).toContain("node:fs");
  });
});

describe("medium/esm-config.mjs", () => {
  it("extracts ESM async, generator, and dynamic-import patterns", async () => {
    const source = loadFixture(packageRoot, "medium/esm-config.mjs");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "medium/esm-config.mjs");

    const symbolNames = result.symbols.map((s) => s.name).sort();
    expect(symbolNames).toContain("loadConfig");
    expect(symbolNames).toContain("eachSource");
    expect(symbolNames).toContain("loadSourcePlugin");
    expect(symbolNames).toContain("DEFAULT_TIMEOUT_MS");
    expect(symbolNames).toContain("SOURCES");

    const loadCfg = result.symbols.find((s) => s.name === "loadConfig");
    expect(loadCfg?.decorators).toContain("async");

    const eachSource = result.symbols.find((s) => s.name === "eachSource");
    expect(eachSource?.decorators).toContain("generator");

    const loadPlugin = result.symbols.find((s) => s.name === "loadSourcePlugin");
    expect(loadPlugin?.decorators).toContain("async");

    const modules = result.imports.map((i) => i.module).sort();
    expect(modules).toContain("node:fs/promises");
    expect(modules).toContain("node:path");

    expect(result.exports).toContain("default");
    expect(result.exports).toContain("loadConfig");
  });
});
