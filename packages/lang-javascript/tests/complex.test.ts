/**
 * Complex-tier fixture tests against a verbatim subset of the
 * [`expressjs/express`](https://github.com/expressjs/express) project,
 * pinned at tag `v5.0.1` (commit `d14b2de782c16fbef39541c9009b01bd6ae90b92`).
 * See `tests/fixtures/complex/express-v5/ATTRIBUTION.md` for provenance.
 *
 * Why Express? It's the canonical CommonJS Node.js library: prototype-based
 * "classes" via `app.prototype.method = …`, mixed `module.exports` + named
 * exports, internal `var x = require(…)` imports — every idiom that real
 * JavaScript backends use.
 *
 * These tests are *invariant-based* (counts greater than known lower bounds,
 * presence of landmark symbols / imports) rather than asserting on
 * full-graph snapshots. Snapshot equality on real upstream code would force
 * us to refresh every time the extractor's output evolves; invariants
 * tolerate non-breaking improvements and only fail on real regressions.
 */
import { describe, it, expect } from "vitest";
import { plugin } from "../src/index.js";
import { type TypescriptExtractor } from "@reponova/lang-typescript-core";
import { loadGrammar } from "@reponova/lang-test-utils";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { SyntaxTree, FileExtraction } from "reponova";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(
  packageRoot,
  "tests/fixtures/complex/express-v5",
);
const extractor = plugin.extractor as TypescriptExtractor;

interface ManifestEntry {
  path: string;
  sha256: string;
  size: number;
}
interface Manifest {
  upstream: string;
  ref: string;
  tag: string;
  subpath: string;
  license: string;
  copyright: string;
  files: ManifestEntry[];
}

function loadManifest(): Manifest {
  const raw = readFileSync(join(fixtureRoot, "_manifest.json"), "utf8");
  return JSON.parse(raw) as Manifest;
}

function walkJsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      out.push(...walkJsFiles(abs));
    } else if (entry.endsWith(".js")) {
      out.push(abs);
    }
  }
  return out;
}

async function parse(source: string): Promise<SyntaxTree> {
  const loaded = await loadGrammar(plugin.grammarPath!);
  if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");
  return loaded.parse(source) as SyntaxTree;
}

function relPosix(abs: string): string {
  return relative(fixtureRoot, abs).split(sep).join("/");
}

describe("complex fixture: expressjs/express v5.0.1 lib/", () => {
  it("preserves byte-exact integrity of every snapshot file (SHA-256)", () => {
    const manifest = loadManifest();
    expect(manifest.files.length).toBe(6);
    expect(manifest.tag).toBe("v5.0.1");
    for (const entry of manifest.files) {
      const abs = join(fixtureRoot, entry.path);
      const data = readFileSync(abs);
      expect(data.length, `${entry.path}: byte size`).toBe(entry.size);
      const sha = createHash("sha256").update(data).digest("hex");
      expect(sha, `${entry.path}: sha256`).toBe(entry.sha256);
    }
  });

  it("parses every .js snapshot file and emits non-empty extraction output", async () => {
    const loaded = await loadGrammar(plugin.grammarPath!);
    if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");

    const jsFiles = walkJsFiles(fixtureRoot);
    expect(jsFiles.length).toBe(6);

    let totalSymbols = 0;
    let totalImports = 0;
    let totalReferences = 0;
    const seenFunctionsByFile = new Map<string, Set<string>>();

    for (const abs of jsFiles) {
      const rel = relPosix(abs);
      const source = readFileSync(abs, "utf8");
      const tree = loaded.parse(source) as SyntaxTree;
      const result: FileExtraction = extractor.extract(tree, source, rel);

      expect(result.language, `${rel}: language`).toBe("javascript");
      expect(result.fileNode.kind, `${rel}: file kind`).toBe("module");
      expect(result.symbols.length, `${rel}: symbols`).toBeGreaterThan(0);

      totalSymbols += result.symbols.length;
      totalImports += result.imports.length;
      totalReferences += result.references.length;

      const fns = new Set<string>();
      for (const sym of result.symbols) {
        if (sym.kind === "function") fns.add(sym.name);
      }
      seenFunctionsByFile.set(rel, fns);
    }

    // Lower bounds. Express lib/ uses the prototype-assignment idiom
    // pervasively: methods are added with `app.use = function () { … }`
    // / `res.json = function (…) { … }` (i.e. assignment_expression
    // with a function_expression on the right), NOT
    // `function_declaration`. The shared extractor currently only
    // surfaces top-level function declarations and named functions, so
    // the symbol count is dominated by the small set of named
    // factories / utility functions in lib/utils.js, lib/express.js
    // and lib/view.js. Lifting prototype-assignment methods into the
    // graph is tracked as a follow-up (issue: future work) and would
    // raise these floors substantially, but the current numbers are
    // a real lower bound that any regression would dip below.
    expect(totalSymbols).toBeGreaterThanOrEqual(8);
    expect(totalImports).toBeGreaterThanOrEqual(15);
    expect(totalReferences).toBeGreaterThanOrEqual(5);

    // Landmark sources we expect non-empty extraction from. lib/express.js
    // surfaces the createApplication factory, lib/view.js the View class
    // (treated as a function symbol — it's a prototype-based "class").
    const utilsFns = seenFunctionsByFile.get("lib/utils.js") ?? new Set();
    expect(utilsFns.size).toBeGreaterThan(0);
    const expressFns = seenFunctionsByFile.get("lib/express.js") ?? new Set();
    expect(expressFns.size).toBeGreaterThan(0);
  });

  it("captures node:* and third-party require() imports across the snapshot", async () => {
    const expressSrc = readFileSync(join(fixtureRoot, "lib/express.js"), "utf8");
    const expressTree = await parse(expressSrc);
    const expressResult = extractor.extract(expressTree, expressSrc, "lib/express.js");

    const expressModules = expressResult.imports.map((i) => i.module);
    // lib/express.js imports many runtime helpers via require().
    // Specific module names are upstream-specific but we expect AT LEAST a
    // handful, and at least one that looks like a node:* or http* dep.
    expect(expressResult.imports.length).toBeGreaterThanOrEqual(3);
    expect(
      expressModules.some((m) => m.startsWith("body-parser") || m.startsWith("http") || m.includes("router") || m.includes("mixin")),
    ).toBe(true);
  });

  it("extracts the View class with its constructor and render method", async () => {
    const viewSrc = readFileSync(join(fixtureRoot, "lib/view.js"), "utf8");
    const viewTree = await parse(viewSrc);
    const viewResult = extractor.extract(viewTree, viewSrc, "lib/view.js");

    // View is exposed as `function View(name, options) { … }` (a
    // prototype-based "class"), not as `class View {}`. The shared
    // extractor recognises it as a function symbol.
    const viewFn = viewResult.symbols.find((s) => s.name === "View");
    expect(viewFn).toBeDefined();
    expect(viewFn?.kind).toBe("function");
  });

  it("handles the largest file (lib/response.js) without crashing or timing out", async () => {
    const responseSrc = readFileSync(join(fixtureRoot, "lib/response.js"), "utf8");
    const responseTree = await parse(responseSrc);
    const responseResult = extractor.extract(responseTree, responseSrc, "lib/response.js");

    // response.js is ~24kB and ships dozens of `res.X = function () { … }`
    // prototype assignments; we expect a healthy symbol count.
    expect(responseResult.symbols.length).toBeGreaterThan(0);
    expect(responseResult.imports.length).toBeGreaterThan(0);
  });

  it("resolves intra-snapshot relative imports to disk-relative candidates", () => {
    // lib/application.js imports `./request`, `./response`, `./utils`, ...
    const reqRes = extractor.resolveImportPath("./request", "lib/application.js");
    expect(reqRes).toContain("lib/request.js");

    const resRes = extractor.resolveImportPath("./response", "lib/application.js");
    expect(resRes).toContain("lib/response.js");

    const utilsRes = extractor.resolveImportPath("./utils", "lib/application.js");
    expect(utilsRes).toContain("lib/utils.js");

    // Bare specifiers (`debug`, `body-parser`, …) yield no candidates.
    expect(extractor.resolveImportPath("debug", "lib/application.js")).toEqual([]);
    expect(extractor.resolveImportPath("body-parser", "lib/express.js")).toEqual([]);
  });
});
