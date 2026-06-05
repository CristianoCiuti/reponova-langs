/**
 * Fixture-driven tests for the TSX plugin. Loads the simple/medium hand-written
 * fixtures from disk, runs them through the extractor, and asserts on the
 * shape of the resulting graph (symbols, edges, imports). The complex/ tier
 * (OSS snapshot) is exercised in `complex.test.ts`.
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

describe("simple/Counter.tsx", () => {
  it("extracts the functional component, the typed interface, and the constant", async () => {
    const source = loadFixture(packageRoot, "simple/Counter.tsx");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "simple/Counter.tsx");

    const symbolNames = result.symbols.map((s) => s.name).sort();
    expect(symbolNames).toContain("Counter");
    expect(symbolNames).toContain("CounterProps");
    expect(symbolNames).toContain("DEFAULT_STEP");

    const counter = result.symbols.find((s) => s.name === "Counter");
    expect(counter?.kind).toBe("function");
    expect(counter?.docstring).toMatch(/Functional component/);

    const counterCalls = result.references
      .filter((r) => r.kind === "calls" && r.fromSymbol === "simple.Counter.Counter")
      .map((r) => r.name);
    expect(counterCalls).toContain("useState");
    expect(counterCalls).toContain("useCallback");

    const defaultStep = result.symbols.find((s) => s.name === "DEFAULT_STEP");
    expect(defaultStep?.kind).toBe("constant");

    expect(result.imports.map((i) => i.module)).toContain("react");
    expect(result.exports).toContain("default");
  });

  it("treats the file node as a TSX module", async () => {
    const source = loadFixture(packageRoot, "simple/Counter.tsx");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "simple/Counter.tsx");
    expect(result.fileNode.kind).toBe("module");
    expect(result.fileNode.label).toBe("Counter.tsx");
    expect(result.language).toBe("tsx");
  });
});

describe("medium/Card.tsx", () => {
  it("extracts the Card and CompactCard components plus the variant constant", async () => {
    const source = loadFixture(packageRoot, "medium/Card.tsx");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "medium/Card.tsx");

    const symbolNames = result.symbols.map((s) => s.name).sort();
    expect(symbolNames).toContain("Card");
    expect(symbolNames).toContain("CompactCard");
    expect(symbolNames).toContain("CardProps");
    expect(symbolNames).toContain("CARD_VARIANTS");
    expect(symbolNames).toContain("CardVariant");

    const compactCard = result.symbols.find((s) => s.name === "CompactCard");
    expect(compactCard?.kind).toBe("function");
    const compactCalls = result.references
      .filter((r) => r.kind === "calls" && r.fromSymbol === "medium.Card.CompactCard")
      .map((r) => r.name);
    expect(compactCalls).toContain("Card");
  });
});

describe("medium/Modal.tsx", () => {
  it("extracts the abstract Overlay base and the concrete Modal class with lifecycle methods", async () => {
    const source = loadFixture(packageRoot, "medium/Modal.tsx");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "medium/Modal.tsx");

    const overlay = result.symbols.find((s) => s.kind === "class" && s.name === "Overlay");
    expect(overlay).toBeDefined();
    expect(overlay?.bases).toContain("Component");

    const modal = result.symbols.find((s) => s.kind === "class" && s.name === "Modal");
    expect(modal).toBeDefined();
    expect(modal?.bases).toContain("Overlay");

    const modalMethods = result.symbols
      .filter((s) => s.kind === "method" && s.parent === "Modal")
      .map((s) => s.name)
      .sort();
    expect(modalMethods).toContain("componentDidMount");
    expect(modalMethods).toContain("componentDidUpdate");
    expect(modalMethods).toContain("dismiss");
    expect(modalMethods).toContain("render");

    const dismiss = result.symbols.find(
      (s) => s.kind === "method" && s.parent === "Modal" && s.name === "dismiss",
    );
    expect(dismiss?.decorators).toContain("loggable");
  });
});

describe("medium/App.tsx", () => {
  it("extracts the App component, captures its imports, and surfaces re-exports", async () => {
    const source = loadFixture(packageRoot, "medium/App.tsx");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "medium/App.tsx");

    const app = result.symbols.find((s) => s.name === "App");
    expect(app?.kind).toBe("function");

    const appCalls = result.references
      .filter((r) => r.kind === "calls" && r.fromSymbol === "medium.App.App")
      .map((r) => r.name);
    // hook calls
    expect(appCalls).toContain("useState");
    expect(appCalls).toContain("useMemo");
    expect(appCalls).toContain("useEffect");
    // JSX component usages
    expect(appCalls).toContain("Fragment");
    expect(appCalls).toContain("Card");
    expect(appCalls).toContain("CompactCard");
    expect(appCalls).toContain("Modal");

    const importedModules = result.imports.map((i) => i.module).sort();
    expect(importedModules).toContain("react");
    expect(importedModules).toContain("./Card.js");
    expect(importedModules).toContain("./Modal.js");

    const reExports = result.imports.filter((i) => i.isExport);
    const reModules = reExports.map((i) => i.module).sort();
    expect(reModules).toContain("./Card.js");
    expect(reModules).toContain("./Modal.js");

    expect(result.exports).toContain("App");
    expect(result.exports).toContain("default");
  });
});
