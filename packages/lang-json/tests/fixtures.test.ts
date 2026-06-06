/**
 * Fixture-based tests for @reponova/lang-json.
 *
 * Tiers (per INTEGRATION-PLAN.md §8.7):
 *  - simple/   : an isolated package.json + sibling tsconfig.json.
 *  - medium/   : a 2-tier workspace (root + packages/core + apps/web)
 *                with a tsconfig.base.json + project references graph
 *                AND an `eslint-overrides.jsonc` exercising JSONC syntax.
 *  - complex/  : a synthetic Nx-shaped monorepo (3 projects + nx.json +
 *                project.json's + tsconfig graph). See
 *                `complex/nx-shaped/_manifest.json` for provenance and
 *                expected invariants.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonExtractor } from "../src/index.js";
import { loadFixture } from "@reponova/lang-test-utils";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ext = new JsonExtractor();

describe("simple fixture: standalone widget package", () => {
  it("package.json: extracts deps, scripts, bin, name", () => {
    const src = loadFixture(packageRoot, "simple/package.json");
    const r = ext.extract(null, src, "simple/package.json");
    expect(r.fileNode.kind).toBe("module");
    expect(r.fileNode.label).toBe("@example/widget");
    expect(r.imports.map((i) => i.module).sort()).toEqual(["lodash", "vitest", "zod"]);
    expect(r.symbols.filter((s) => s.decorators.includes("npm-script")).map((s) => s.name).sort())
      .toEqual(["build", "lint", "test"]);
    expect(r.symbols.find((s) => s.decorators.includes("npm-bin"))?.name).toBe("widget-cli");
  });

  it("tsconfig.json: extracts paths alias", () => {
    const src = loadFixture(packageRoot, "simple/tsconfig.json");
    const r = ext.extract(null, src, "simple/tsconfig.json");
    expect(r.fileNode.tags).toContain("tsconfig");
    const aliasImport = r.imports.find((i) => i.names.includes("@widget/*"));
    expect(aliasImport).toBeDefined();
    expect(aliasImport!.module).toBe("./src/*");
    expect(aliasImport!.isWildcard).toBe(true);
  });
});

describe("medium fixture: workspace root + 2 children + JSONC overrides", () => {
  it("root package.json: workspaces + scripts + dev/peer deps", () => {
    const src = loadFixture(packageRoot, "medium/package.json");
    const r = ext.extract(null, src, "medium/package.json");
    expect(r.fileNode.tags).toEqual(
      expect.arrayContaining(["package.json", "private", "workspaces"]),
    );
    const scriptNames = r.symbols
      .filter((s) => s.decorators.includes("npm-script"))
      .map((s) => s.name)
      .sort();
    expect(scriptNames).toEqual(["build", "format", "lint", "test"]);
    const wildcardImports = r.imports.filter((i) => i.isWildcard).map((i) => i.module).sort();
    expect(wildcardImports).toEqual(["apps/web", "packages/*"]);
    const allModules = r.imports.map((i) => i.module);
    expect(allModules).toEqual(expect.arrayContaining(["typescript", "react", "eslint", "prettier"]));
  });

  it("tsconfig.base: paths alias graph", () => {
    const src = loadFixture(packageRoot, "medium/tsconfig.base.json");
    const r = ext.extract(null, src, "medium/tsconfig.base.json");
    const aliases = r.imports.map((i) => i.names[0]).sort();
    expect(aliases).toEqual(["@core/*", "@web/*"]);
  });

  it("solution-style root tsconfig: 1 extends + 2 references", () => {
    const src = loadFixture(packageRoot, "medium/tsconfig.json");
    const r = ext.extract(null, src, "medium/tsconfig.json");
    expect(r.fileNode.tags).toEqual(
      expect.arrayContaining(["tsconfig", "extends", "project-references"]),
    );
    const extendsImport = r.imports.find((i) => i.names.includes("extends"));
    expect(extendsImport!.module).toBe("./tsconfig.base.json");
    const refs = r.imports.filter((i) => i.names.includes("reference")).map((i) => i.module).sort();
    expect(refs).toEqual(["./apps/web", "./packages/core"]);
  });

  it("packages/core/tsconfig.json: extends path is relative to its own dir", () => {
    const src = loadFixture(packageRoot, "medium/packages/core/tsconfig.json");
    const r = ext.extract(null, src, "medium/packages/core/tsconfig.json");
    const extendsImport = r.imports.find((i) => i.names.includes("extends"));
    expect(extendsImport!.module).toBe("../../tsconfig.base.json");
    // Use the extractor's resolveImportPath to validate it would point
    // at the right file from the project graph's perspective.
    const candidates = ext.resolveImportPath(
      extendsImport!.module,
      "medium/packages/core/tsconfig.json",
    );
    expect(candidates).toContain("medium/tsconfig.base.json");
  });

  it("eslint-overrides.jsonc: JSONC parsing handles comments + trailing comma", () => {
    const src = loadFixture(packageRoot, "medium/eslint-overrides.jsonc");
    const r = ext.extract(null, src, "medium/eslint-overrides.jsonc");
    expect(r.fileNode.tags).toContain("json");
    // top-level keys → variable symbols
    const keys = r.symbols.filter((s) => s.decorators.includes("json-key")).map((s) => s.name).sort();
    expect(keys).toEqual(["ignorePatterns", "rules"]);
  });
});

describe("complex fixture: synthetic Nx-shaped monorepo", () => {
  const fixtureRoot = "complex/nx-shaped";

  it("manifest documents the expected shape and invariants", () => {
    const manifest = JSON.parse(loadFixture(packageRoot, `${fixtureRoot}/_manifest.json`));
    expect(manifest.fixture).toBe("nx-shaped");
    expect(manifest.kind).toBe("synthetic");
    expect(manifest.shape_inspired_by.project).toBe("nrwl/nx");
    expect(manifest.files.length).toBeGreaterThanOrEqual(10);
    expect(manifest.expected_invariants.files_with_module_node).toBeGreaterThanOrEqual(10);
  });

  it("nx.json: surfaces target defaults + plugins + namedInputs + generators", () => {
    const src = loadFixture(packageRoot, `${fixtureRoot}/nx.json`);
    const r = ext.extract(null, src, `${fixtureRoot}/nx.json`);

    expect(r.fileNode.tags).toEqual(expect.arrayContaining(["nx", "monorepo"]));

    const tdefs = r.symbols
      .filter((s) => s.decorators.includes("nx-target-default"))
      .map((s) => s.name)
      .sort();
    expect(tdefs).toEqual(["@nx/jest:jest", "build", "lint", "test"]);

    const named = r.symbols
      .filter((s) => s.decorators.includes("nx-named-input"))
      .map((s) => s.name)
      .sort();
    expect(named).toEqual(["default", "production", "sharedGlobals"]);

    const plugins = r.imports.filter((i) => i.names.includes("nx-plugin")).map((i) => i.module);
    expect(plugins).toEqual(
      expect.arrayContaining([
        "@nx/esbuild/plugin",
        "@nx/eslint/plugin",
        "@nx/vite/plugin",
      ]),
    );

    const generators = r.imports.filter((i) => i.names.includes("nx-generator")).map((i) => i.module);
    expect(generators).toEqual(expect.arrayContaining(["@nx/react", "@nx/js:library"]));
  });

  it("auth/project.json: targets, tags, no implicit deps", () => {
    const src = loadFixture(packageRoot, `${fixtureRoot}/libs/auth/project.json`);
    const r = ext.extract(null, src, `${fixtureRoot}/libs/auth/project.json`);
    expect(r.fileNode.label).toBe("auth");
    expect(r.fileNode.tags).toEqual(expect.arrayContaining(["nx-project", "nx-library"]));
    const targets = r.symbols.filter((s) => s.decorators.includes("nx-target")).map((s) => s.name).sort();
    expect(targets).toEqual(["build", "lint", "test"]);
    const tags = r.symbols.filter((s) => s.decorators.includes("nx-tag")).map((s) => s.name).sort();
    expect(tags).toEqual(["scope:auth", "type:lib"]);
    expect(r.references).toEqual([]);
  });

  it("billing/project.json: implicit dep on auth + extra publish target", () => {
    const src = loadFixture(packageRoot, `${fixtureRoot}/libs/billing/project.json`);
    const r = ext.extract(null, src, `${fixtureRoot}/libs/billing/project.json`);
    expect(r.references.map((rf) => rf.name)).toContain("auth");
    expect(r.references.find((rf) => rf.name === "auth")!.kind).toBe("references");
    const targets = r.symbols.filter((s) => s.decorators.includes("nx-target")).map((s) => s.name).sort();
    expect(targets).toEqual(["build", "lint", "publish", "test"]);
  });

  it("web/project.json: app-type, depends on both libs, fills `dependsOn` chain", () => {
    const src = loadFixture(packageRoot, `${fixtureRoot}/apps/web/project.json`);
    const r = ext.extract(null, src, `${fixtureRoot}/apps/web/project.json`);
    expect(r.fileNode.tags).toEqual(expect.arrayContaining(["nx-project", "nx-application"]));
    const refs = r.references.map((rf) => rf.name).sort();
    expect(refs).toEqual(["auth", "billing"]);
    const targets = r.symbols.filter((s) => s.decorators.includes("nx-target")).map((s) => s.name).sort();
    expect(targets).toEqual(["build", "lint", "serve", "test"]);
  });

  it("aggregate invariants across all 10 files of the fixture match the manifest", () => {
    const manifest = JSON.parse(loadFixture(packageRoot, `${fixtureRoot}/_manifest.json`));
    let totalSymbols = 0;
    let totalImports = 0;
    let totalReferences = 0;
    let moduleNodes = 0;

    for (const rel of manifest.files as string[]) {
      const fullRel = `${fixtureRoot}/${rel}`;
      const src = readFileSync(resolve(packageRoot, "tests/fixtures", fullRel), "utf8");
      const r = ext.extract(null, src, fullRel);
      totalSymbols += r.symbols.length;
      totalImports += r.imports.length;
      totalReferences += r.references.length;
      if (r.fileNode.kind === "module") moduleNodes += 1;
    }

    const inv = manifest.expected_invariants;
    expect(totalSymbols).toBeGreaterThanOrEqual(inv.min_total_symbols);
    expect(totalImports).toBeGreaterThanOrEqual(inv.min_total_imports);
    expect(totalReferences).toBeGreaterThanOrEqual(inv.min_total_references);
    expect(moduleNodes).toBe(inv.files_with_module_node);
  });
});
