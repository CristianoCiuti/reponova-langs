/**
 * Complex fixture: zod v3.24.1 (subset of src/, MIT-licensed snapshot).
 *
 * See `tests/fixtures/complex/zod-v3.24.1/ATTRIBUTION.md` for provenance.
 *
 * These tests guard against regressions on real-world TypeScript that exercises
 * heavy generics, conditional types, class hierarchies, and type-only imports.
 * They are intentionally non-snapshot: we assert structural invariants
 * (landmark symbols, import counts, no parse failures), not exact AST shape,
 * to keep maintenance cost low when the extractor surface grows.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { SyntaxTree } from "reponova";
import { TypescriptExtractor } from "../src/index.js";
import { loadGrammar } from "@reponova/lang-test-utils";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(packageRoot, "tests/fixtures/complex/zod-v3.24.1");
const grammarPath = resolve(
  packageRoot,
  "../lang-typescript/grammars/tree-sitter-typescript.wasm",
);

function walkTsFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        out.push(abs);
      }
    }
  }
  return out.sort();
}

describe("complex fixture: zod v3.24.1", () => {
  it("parses every snapshot file without errors and emits non-empty symbols", async () => {
    const loaded = await loadGrammar(grammarPath);
    if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");

    const files = walkTsFiles(join(fixtureRoot, "src"));
    expect(files.length).toBe(13);

    let totalSymbols = 0;
    let totalImports = 0;
    let totalReferences = 0;
    const perFileSymbolCounts = new Map<string, number>();

    // Barrel-only files (pure re-exports / namespace aliasing) legitimately
    // emit zero symbols of their own; they are validated by the import count.
    const barrelFiles = new Set(["src/external.ts", "src/index.ts"]);

    for (const abs of files) {
      const rel = relative(fixtureRoot, abs).split(sep).join("/");
      const source = readFileSync(abs, "utf8");
      const tree = loaded.parse(source) as SyntaxTree;
      const result = new TypescriptExtractor().extract(tree, source, rel);

      if (barrelFiles.has(rel)) {
        expect(result.imports.length, `barrel ${rel} should re-export at least one module`)
          .toBeGreaterThan(0);
      } else {
        expect(result.symbols.length, `no symbols emitted from ${rel}`).toBeGreaterThan(0);
      }
      perFileSymbolCounts.set(rel, result.symbols.length);
      totalSymbols += result.symbols.length;
      totalImports += result.imports.length;
      totalReferences += result.references.length;
    }

    expect(totalSymbols).toBeGreaterThan(200);
    expect(totalImports).toBeGreaterThan(20);
    expect(totalReferences).toBeGreaterThan(50);

    const typesCount = perFileSymbolCounts.get("src/types.ts") ?? 0;
    expect(typesCount, "types.ts should dominate the symbol count").toBeGreaterThan(150);
  });

  it("extracts landmark Zod classes from src/types.ts", async () => {
    const loaded = await loadGrammar(grammarPath);
    if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");

    const source = readFileSync(join(fixtureRoot, "src/types.ts"), "utf8");
    const tree = loaded.parse(source) as SyntaxTree;
    const result = new TypescriptExtractor().extract(tree, source, "src/types.ts");

    const classNames = result.symbols
      .filter((s) => s.kind === "class")
      .map((s) => s.name);

    for (const landmark of [
      "ZodType",
      "ZodString",
      "ZodNumber",
      "ZodBoolean",
      "ZodObject",
      "ZodArray",
      "ZodUnion",
      "ZodEffects",
      "ZodOptional",
      "ZodNullable",
    ]) {
      expect(classNames, `expected class ${landmark} in types.ts`).toContain(landmark);
    }
  });

  it("extracts ZodError class with its key methods from src/ZodError.ts", async () => {
    const loaded = await loadGrammar(grammarPath);
    if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");

    const source = readFileSync(join(fixtureRoot, "src/ZodError.ts"), "utf8");
    const tree = loaded.parse(source) as SyntaxTree;
    const result = new TypescriptExtractor().extract(tree, source, "src/ZodError.ts");

    const zodError = result.symbols.find((s) => s.kind === "class" && s.name === "ZodError");
    expect(zodError).toBeDefined();

    const methodsOnZodError = result.symbols
      .filter((s) => s.kind === "method" && s.parent === "ZodError")
      .map((s) => s.name);
    expect(methodsOnZodError.length).toBeGreaterThan(0);
  });

  it("captures barrel re-exports from src/external.ts", async () => {
    const loaded = await loadGrammar(grammarPath);
    if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");

    const source = readFileSync(join(fixtureRoot, "src/external.ts"), "utf8");
    const tree = loaded.parse(source) as SyntaxTree;
    const result = new TypescriptExtractor().extract(tree, source, "src/external.ts");

    const reExports = result.imports.filter((i) => i.isExport);
    expect(reExports.length).toBeGreaterThan(0);

    const modules = reExports.map((i) => i.module);
    expect(modules.some((m) => m.includes("errors") || m.includes("types") || m.includes("ZodError"))).toBe(true);
  });

  it("handles deep generics in src/helpers/util.ts without crashing", async () => {
    const loaded = await loadGrammar(grammarPath);
    if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");

    const source = readFileSync(join(fixtureRoot, "src/helpers/util.ts"), "utf8");
    const tree = loaded.parse(source) as SyntaxTree;
    const result = new TypescriptExtractor().extract(tree, source, "src/helpers/util.ts");

    expect(result.symbols.length).toBeGreaterThan(0);
    const namespaceSyms = result.symbols.filter((s) => s.kind === "namespace");
    expect(namespaceSyms.length, "util.ts uses `namespace util`").toBeGreaterThan(0);
  });
});
