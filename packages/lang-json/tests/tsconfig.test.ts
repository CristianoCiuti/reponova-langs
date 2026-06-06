import { describe, expect, it } from "vitest";
import { JsonExtractor } from "../src/index.js";

const ext = new JsonExtractor();

describe("extractor: tsconfig*.json semantics", () => {
  it("emits an `extends` import for the single-string form", () => {
    const src = JSON.stringify({
      extends: "../../tsconfig.base.json",
      compilerOptions: { strict: true },
    });
    const r = ext.extract(null, src, "apps/web/tsconfig.json");
    expect(r.fileNode.tags).toEqual(expect.arrayContaining(["tsconfig", "extends"]));
    const extendsImport = r.imports.find((i) => i.names.includes("extends"));
    expect(extendsImport).toBeDefined();
    expect(extendsImport!.module).toBe("../../tsconfig.base.json");
  });

  it("emits one import per entry for the array `extends` form (TS 5.0+)", () => {
    const src = JSON.stringify({
      extends: ["@tsconfig/node20/tsconfig.json", "./tsconfig.local.json"],
    });
    const r = ext.extract(null, src, "tsconfig.json");
    const extendsImports = r.imports.filter((i) => i.names.includes("extends"));
    expect(extendsImports.map((i) => i.module).sort()).toEqual(
      ["./tsconfig.local.json", "@tsconfig/node20/tsconfig.json"].sort(),
    );
  });

  it("emits a reference import for each project reference", () => {
    const src = JSON.stringify({
      files: [],
      references: [
        { path: "./packages/core" },
        { path: "./apps/web" },
      ],
    });
    const r = ext.extract(null, src, "tsconfig.json");
    expect(r.fileNode.tags).toEqual(expect.arrayContaining(["project-references"]));
    const refs = r.imports.filter((i) => i.names.includes("reference"));
    expect(refs.map((i) => i.module).sort()).toEqual(["./apps/web", "./packages/core"]);
  });

  it("expands compilerOptions.paths into one import per target with the alias as the name", () => {
    const src = JSON.stringify({
      compilerOptions: {
        paths: {
          "@core/*": ["./packages/core/src/*"],
          "@util": ["./util/index.ts", "./util/legacy.ts"],
        },
      },
    });
    const r = ext.extract(null, src, "tsconfig.base.json");
    const aliasImports = r.imports.filter((i) =>
      i.names.includes("@core/*") || i.names.includes("@util"),
    );
    expect(aliasImports.length).toBe(3);
    const wildcard = aliasImports.find((i) => i.names.includes("@core/*"));
    expect(wildcard!.isWildcard).toBe(true);
    const utilTargets = aliasImports
      .filter((i) => i.names.includes("@util"))
      .map((i) => i.module)
      .sort();
    expect(utilTargets).toEqual(["./util/index.ts", "./util/legacy.ts"]);
  });

  it("is tolerant of JSONC: comments and trailing commas", () => {
    const src = `{
      // root tsconfig — extends the shared base
      "extends": "./tsconfig.base.json",
      /* references the workspace projects */
      "references": [
        { "path": "./packages/core" },
        { "path": "./apps/web" }, // last reference
      ],
    }`;
    const r = ext.extract(null, src, "tsconfig.json");
    const refs = r.imports.filter((i) => i.names.includes("reference"));
    expect(refs.length).toBe(2);
    expect(refs.map((i) => i.module).sort()).toEqual(["./apps/web", "./packages/core"]);
  });

  it("does NOT emit an extends tag when the extends key is absent", () => {
    const r = ext.extract(null, JSON.stringify({ compilerOptions: { strict: true } }), "tsconfig.json");
    expect(r.fileNode.tags).toContain("tsconfig");
    expect(r.fileNode.tags).not.toContain("extends");
    expect(r.fileNode.tags).not.toContain("project-references");
  });
});

describe("JsonExtractor.resolveImportPath (tsconfig path resolution)", () => {
  it("resolves a sibling './foo.json' relative to the current file's directory", () => {
    const candidates = ext.resolveImportPath("./foo.json", "apps/web/tsconfig.json");
    expect(candidates).toContain("apps/web/foo.json");
  });

  it("normalises traversal and preserves the .json suffix when present", () => {
    const candidates = ext.resolveImportPath("../../tsconfig.base.json", "apps/web/tsconfig.json");
    expect(candidates).toContain("tsconfig.base.json");
  });

  it("appends `.json` when the spec is missing it", () => {
    const candidates = ext.resolveImportPath("../shared/base", "apps/web/tsconfig.json");
    expect(candidates).toContain("apps/shared/base.json");
  });

  it("returns an empty list for bare specifiers (delegates to upstream resolver)", () => {
    const candidates = ext.resolveImportPath("@tsconfig/node20/tsconfig.json", "tsconfig.json");
    expect(candidates).toEqual([]);
  });

  it("returns an empty list for an empty spec", () => {
    expect(ext.resolveImportPath("", "tsconfig.json")).toEqual([]);
  });

  it("offers the implicit /tsconfig.json alongside the directory candidate", () => {
    const candidates = ext.resolveImportPath("./libs/core", "tsconfig.json");
    expect(candidates).toContain("libs/core/tsconfig.json");
  });
});
