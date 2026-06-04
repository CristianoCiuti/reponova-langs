/**
 * Fixture-based tests for @reponova/lang-svg.
 *
 * Tiers (per INTEGRATION-PLAN.md §8.7):
 *  - simple/   : a 3-tier layout with 3 labelled boxes
 *  - medium/   : a richer "Operations Dashboard" mock with gradients,
 *                filters, patterns, and ~10 distinct text labels
 *  - complex/  : a curated 75-icon snapshot of `simple-icons/simple-icons`
 *                v16.22.0 (CC0), exercising path-only / decorative SVGs
 *                that intentionally have no `<title>`/`<text>` content.
 *
 * The SVG extractor is regex-based and intentionally lossy (it samples the
 * first ~20 informative `<text>` elements). These tests assert structural
 * invariants, not exact string snapshots.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SvgExtractor } from "../src/index.js";
import { loadFixture } from "@reponova/lang-test-utils";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("simple/layout.svg fixture", () => {
  it("extracts the title and the three tier labels", () => {
    const source = loadFixture(packageRoot, "simple/layout.svg");
    const result = new SvgExtractor().extract(null, source, "simple/layout.svg");

    expect(result.fileNode.docstring).toBe("Three-tier layout");
    expect(result.fileNode.tags).toContain("svg");

    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("Frontend");
    expect(names).toContain("API");
    expect(names).toContain("Database");
  });
});

describe("medium/dashboard.svg fixture", () => {
  it("extracts the title and a representative subset of widget labels", () => {
    const source = loadFixture(packageRoot, "medium/dashboard.svg");
    const result = new SvgExtractor().extract(null, source, "medium/dashboard.svg");

    expect(result.fileNode.docstring).toBe("Operations Dashboard");

    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("RepoNova");
    expect(names).toContain("Active_Repos");
    expect(names).toContain("Open_PRs");
    expect(names).toContain("Failing_Builds");

    expect(result.symbols.length).toBeLessThanOrEqual(20);
  });
});

describe("complex fixture: simple-icons 16.22.0", () => {
  const iconsDir = resolve(packageRoot, "tests/fixtures/complex/simple-icons-16.22.0/icons");

  it("parses every icon without crashing and tags the file as svg", () => {
    const ext = new SvgExtractor();
    const files = readdirSync(iconsDir).filter((f) => f.endsWith(".svg")).sort();
    expect(files.length).toBe(75);

    let totalSymbols = 0;
    let withTitle = 0;
    for (const f of files) {
      const source = readFileSync(resolve(iconsDir, f), "utf8");
      const result = ext.extract(null, source, `complex/simple-icons-16.22.0/icons/${f}`);
      expect(result.fileNode.tags, `${f}: should be tagged svg`).toContain("svg");
      totalSymbols += result.symbols.length;
      if (result.fileNode.docstring) withTitle += 1;
    }

    // The simple-icons SVG format puts the brand name in a top-level
    // <title> element. The extractor surfaces every <title> as both the
    // file docstring and a `section` symbol, so the bulk of the 75 icons
    // contribute exactly one symbol; the cap of 20 per file is never
    // tripped because each icon has only one label.
    expect(withTitle).toBeGreaterThanOrEqual(70);
    expect(totalSymbols).toBeGreaterThanOrEqual(70);
  });

  it("docker.svg extracts cleanly and recovers the brand name from <title>", () => {
    const source = readFileSync(resolve(iconsDir, "docker.svg"), "utf8");
    const result = new SvgExtractor().extract(null, source, "complex/simple-icons-16.22.0/icons/docker.svg");
    expect(result.fileNode.kind).toBe("diagram");
    expect(result.language).toBe("diagram");
    expect(result.fileNode.docstring).toBe("Docker");
    const docstrings = result.symbols.map((s) => s.docstring);
    expect(docstrings).toContain("Docker");
  });

  it("does not throw on the largest icon (postgresql.svg)", () => {
    const source = readFileSync(resolve(iconsDir, "postgresql.svg"), "utf8");
    expect(() =>
      new SvgExtractor().extract(null, source, "complex/simple-icons-16.22.0/icons/postgresql.svg"),
    ).not.toThrow();
  });
});
