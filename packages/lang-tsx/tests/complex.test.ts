/**
 * Complex-tier fixture tests against a verbatim subset of
 * `vercel/next.js/examples/with-typescript`, pinned at commit
 * `84f9247617f91917bfeecd9c6d95b1dedef4a411`. See
 * `tests/fixtures/complex/next-with-typescript/ATTRIBUTION.md` for provenance.
 *
 * These tests are deliberately *invariant-based* (counts greater than known
 * lower bounds, presence of landmark symbols, presence of landmark imports)
 * rather than asserting on full-graph snapshots. Snapshot equality on real
 * upstream code would force us to refresh the snapshot every time the
 * extractor's output evolves; invariants tolerate non-breaking improvements
 * (e.g. capturing more JSX components as call edges) and only fail on real
 * regressions.
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
  "tests/fixtures/complex/next-with-typescript",
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
  subpath: string;
  license: string;
  copyright: string;
  files: ManifestEntry[];
}

function loadManifest(): Manifest {
  const raw = readFileSync(join(fixtureRoot, "_manifest.json"), "utf8");
  return JSON.parse(raw) as Manifest;
}

function walkTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      out.push(...walkTsxFiles(abs));
    } else if (entry.endsWith(".tsx")) {
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

describe("complex fixture: next.js with-typescript", () => {
  it("preserves byte-exact integrity of every snapshot file (SHA-256)", () => {
    const manifest = loadManifest();
    expect(manifest.files.length).toBeGreaterThan(0);
    for (const entry of manifest.files) {
      const abs = join(fixtureRoot, entry.path);
      const data = readFileSync(abs);
      expect(data.length, `${entry.path}: byte size`).toBe(entry.size);
      const sha = createHash("sha256").update(data).digest("hex");
      expect(sha, `${entry.path}: sha256`).toBe(entry.sha256);
    }
  });

  it("parses every .tsx snapshot file and emits non-empty extraction output", async () => {
    const loaded = await loadGrammar(plugin.grammarPath!);
    if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");

    const tsxFiles = walkTsxFiles(fixtureRoot);
    expect(tsxFiles.length).toBe(8);

    let totalSymbols = 0;
    let totalImports = 0;
    let totalReferences = 0;
    const seenComponents = new Set<string>();

    for (const abs of tsxFiles) {
      const rel = relPosix(abs);
      const source = readFileSync(abs, "utf8");
      const tree = loaded.parse(source) as SyntaxTree;
      const result: FileExtraction = extractor.extract(tree, source, rel);

      expect(result.language, `${rel}: language`).toBe("tsx");
      expect(result.fileNode.kind, `${rel}: file kind`).toBe("module");
      expect(result.symbols.length, `${rel}: symbols`).toBeGreaterThan(0);
      expect(result.imports.length, `${rel}: imports`).toBeGreaterThan(0);
      expect(result.exports, `${rel}: default export`).toContain("default");

      totalSymbols += result.symbols.length;
      totalImports += result.imports.length;
      totalReferences += result.references.length;

      for (const sym of result.symbols) {
        if (sym.kind === "function") seenComponents.add(sym.name);
      }
    }

    // Lower bounds: every TSX file in the snapshot has at least one component
    // function plus a typed Props alias; the snapshot also has 8 files.
    // 8 files * (1 component + 1 type alias) = 16 minimum, but in practice
    // pages/users/[id].tsx alone exposes 3 functions and Props. Set the
    // bound to a comfortable floor.
    expect(totalSymbols).toBeGreaterThanOrEqual(16);
    expect(totalImports).toBeGreaterThanOrEqual(16);
    // JSX usage drives the references count up — every file uses at least
    // one component as JSX.
    expect(totalReferences).toBeGreaterThanOrEqual(8);

    // Landmark components from across the snapshot:
    for (const landmark of [
      "Layout",
      "List",
      "ListDetail",
      "ListItem",
      "IndexPage",
      "AboutPage",
      "StaticPropsDetail",
      "WithStaticProps",
    ]) {
      expect(seenComponents, `landmark component: ${landmark}`).toContain(landmark);
    }
  });

  it("captures Next.js framework imports across pages and components", async () => {
    const layoutSrc = readFileSync(join(fixtureRoot, "components/Layout.tsx"), "utf8");
    const layoutTree = await parse(layoutSrc);
    const layoutResult = extractor.extract(layoutTree, layoutSrc, "components/Layout.tsx");

    const layoutModules = layoutResult.imports.map((i) => i.module);
    expect(layoutModules).toContain("react");
    expect(layoutModules).toContain("next/link");
    expect(layoutModules).toContain("next/head");

    // Layout uses <Link/> and <Head/> as JSX: those should surface as calls.
    const layoutCalls = layoutResult.references
      .filter((r) => r.kind === "calls" && r.fromSymbol === "components.Layout.Layout")
      .map((r) => r.name);
    expect(layoutCalls).toContain("Link");
    expect(layoutCalls).toContain("Head");
  });

  it("extracts getStaticProps / getStaticPaths from Pages-Router page files", async () => {
    const pageSrc = readFileSync(join(fixtureRoot, "pages/users/[id].tsx"), "utf8");
    const pageTree = await parse(pageSrc);
    const pageResult = extractor.extract(pageTree, pageSrc, "pages/users/[id].tsx");

    const symbolNames = pageResult.symbols.map((s) => s.name);
    expect(symbolNames).toContain("StaticPropsDetail");
    expect(symbolNames).toContain("getStaticPaths");
    expect(symbolNames).toContain("getStaticProps");

    expect(pageResult.exports).toContain("getStaticPaths");
    expect(pageResult.exports).toContain("getStaticProps");

    // The page composes two upstream components.
    const pageCalls = pageResult.references
      .filter(
        (r) =>
          r.kind === "calls" &&
          r.fromSymbol === "pages.users.[id].StaticPropsDetail",
      )
      .map((r) => r.name);
    expect(pageCalls).toContain("Layout");
    expect(pageCalls).toContain("ListDetail");
  });

  it("resolves intra-snapshot relative imports to disk-relative candidates", () => {
    // ListItem imports `../interfaces` from components/ListItem.tsx
    const listItemRes = extractor.resolveImportPath(
      "../interfaces",
      "components/ListItem.tsx",
    );
    expect(listItemRes).toContain("interfaces.tsx");
    expect(listItemRes).toContain("interfaces.ts");
    expect(listItemRes).toContain("interfaces/index.tsx");
    expect(listItemRes).toContain("interfaces/index.ts");

    // [id].tsx imports `../../components/Layout`
    const idRes = extractor.resolveImportPath(
      "../../components/Layout",
      "pages/users/[id].tsx",
    );
    expect(idRes).toContain("components/Layout.tsx");
    expect(idRes).toContain("components/Layout.ts");

    // Bare `next` package: no disk candidate.
    expect(
      extractor.resolveImportPath("next/link", "pages/index.tsx"),
    ).toEqual([]);
  });
});
