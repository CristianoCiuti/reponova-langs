import { describe, it, expect } from "vitest";
import { TypescriptExtractor } from "../src/index.js";
import { loadFixture, loadGrammar } from "@reponova/lang-test-utils";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SyntaxTree } from "reponova";

// tests/ → package root
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const grammarPath = resolve(
  packageRoot,
  "../lang-typescript/grammars/tree-sitter-typescript.wasm",
);

async function parse(source: string): Promise<SyntaxTree> {
  const loaded = await loadGrammar(grammarPath);
  if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");
  return loaded.parse(source) as SyntaxTree;
}

describe("simple/logger.ts fixture", () => {
  it("produces the expected outline shape", async () => {
    const source = loadFixture(packageRoot, "simple/logger.ts");
    const tree = await parse(source);
    const result = new TypescriptExtractor().extract(tree, source, "simple/logger.ts");

    const symbolNames = result.symbols.map((s) => s.name).sort();
    expect(symbolNames).toContain("LogLevel");
    expect(symbolNames).toContain("Logger");
    expect(symbolNames).toContain("DEFAULT_LEVEL");
    expect(symbolNames).toContain("ConsoleLogger");
    expect(symbolNames).toContain("createLogger");
    expect(symbolNames).toContain("log");

    const importedModules = result.imports.map((i) => i.module);
    expect(importedModules).toContain("node:util");

    expect(result.fileNode.docstring).toBe("Simple structured logger.");
  });
});

describe("medium/repository.ts fixture", () => {
  it("captures classes, decorators, generics, re-exports", async () => {
    const source = loadFixture(packageRoot, "medium/repository.ts");
    const tree = await parse(source);
    const result = new TypescriptExtractor().extract(tree, source, "medium/repository.ts");

    const baseRepo = result.symbols.find((s) => s.name === "BaseRepository");
    expect(baseRepo?.kind).toBe("class");
    expect(baseRepo?.bases).toContain("EventEmitter");

    const inMem = result.symbols.find((s) => s.name === "InMemoryRepository");
    expect(inMem?.bases).toContain("BaseRepository");

    const findMethod = result.symbols.find(
      (s) => s.kind === "method" && s.name === "find" && s.parent === "InMemoryRepository",
    );
    expect(findMethod?.decorators).toContain("loggable");

    const enumSym = result.symbols.find((s) => s.kind === "enum" && s.name === "RepositoryStatus");
    expect(enumSym).toBeDefined();

    const reExports = result.imports.filter((i) => i.isExport);
    const reExportModules = reExports.map((i) => i.module).sort();
    expect(reExportModules).toContain("../simple/logger.js");

    const constant = result.symbols.find((s) => s.name === "REPO_VERSION");
    expect(constant?.kind).toBe("constant");
  });
});
