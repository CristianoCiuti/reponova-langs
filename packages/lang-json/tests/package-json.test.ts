import { describe, expect, it } from "vitest";
import { JsonExtractor } from "../src/index.js";

const ext = new JsonExtractor();

function source(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

describe("extractor: package.json semantics", () => {
  it("extracts name, version, description, scripts, deps", () => {
    const src = source({
      name: "@example/widget",
      version: "1.2.3",
      description: "A widget that does widget things.",
      scripts: { build: "tsup", test: "vitest run" },
      dependencies: { lodash: "^4.17.21" },
      devDependencies: { vitest: "^1.0.0" },
      peerDependencies: { react: ">=18" },
      optionalDependencies: { fsevents: "^2.0.0" },
    });

    const r = ext.extract(null, src, "packages/widget/package.json");

    expect(r.fileNode.kind).toBe("module");
    expect(r.fileNode.label).toBe("@example/widget");
    expect(r.fileNode.docstring).toBe("A widget that does widget things.");
    expect(r.fileNode.tags).toContain("package.json");

    const scriptSymbols = r.symbols.filter((s) => s.decorators.includes("npm-script"));
    expect(scriptSymbols.map((s) => s.name).sort()).toEqual(["build", "test"]);
    expect(scriptSymbols.find((s) => s.name === "build")?.docstring).toBe("tsup");
    expect(scriptSymbols.every((s) => s.kind === "function")).toBe(true);

    const importNames = r.imports.map((i) => i.module);
    expect(importNames).toEqual(
      expect.arrayContaining(["lodash", "vitest", "react", "fsevents"]),
    );
    // Per-import names embed the version range so consumers can pivot.
    expect(r.imports.find((i) => i.module === "lodash")!.names).toEqual([
      "lodash@^4.17.21",
    ]);

    const nameSym = r.symbols.find((s) => s.decorators.includes("package-name"));
    expect(nameSym).toBeDefined();
    expect(nameSym!.kind).toBe("constant");
    expect(nameSym!.docstring).toBe("@example/widget@1.2.3");
  });

  it("surfaces a single-string `bin` field with the package's short name", () => {
    const src = source({
      name: "@scope/cli-tool",
      bin: "./dist/cli.js",
    });
    const r = ext.extract(null, src, "package.json");
    const bin = r.symbols.find((s) => s.decorators.includes("npm-bin"));
    expect(bin).toBeDefined();
    expect(bin!.name).toBe("cli-tool");
    expect(bin!.docstring).toBe("./dist/cli.js");
  });

  it("surfaces every `bin` map entry separately", () => {
    const src = source({
      name: "tools",
      bin: { "tool-a": "./bin/a.js", "tool-b": "./bin/b.js" },
    });
    const r = ext.extract(null, src, "package.json");
    const bins = r.symbols.filter((s) => s.decorators.includes("npm-bin"));
    expect(bins.map((s) => s.name).sort()).toEqual(["tool-a", "tool-b"]);
  });

  it("supports the `workspaces` array form and the `{ packages: [...] }` form", () => {
    const arrForm = source({
      name: "root",
      private: true,
      workspaces: ["packages/*", "apps/*"],
    });
    const rArr = ext.extract(null, arrForm, "package.json");
    const wsArr = rArr.imports.filter((i) => i.isWildcard && i.isExport);
    expect(wsArr.map((i) => i.module).sort()).toEqual(["apps/*", "packages/*"]);

    const objForm = source({
      name: "root",
      workspaces: { packages: ["libs/*"], nohoist: ["**/react"] },
    });
    const rObj = ext.extract(null, objForm, "package.json");
    const wsObj = rObj.imports.filter((i) => i.isWildcard && i.isExport);
    expect(wsObj.map((i) => i.module)).toEqual(["libs/*"]);
  });

  it("tags `private` and `workspaces` packages on the file node", () => {
    const src = source({
      name: "root",
      private: true,
      workspaces: ["packages/*"],
    });
    const r = ext.extract(null, src, "package.json");
    expect(r.fileNode.tags).toEqual(
      expect.arrayContaining(["package.json", "private", "workspaces"]),
    );
  });

  it("emits dep symbols even when the package has no name", () => {
    const r = ext.extract(null, source({ dependencies: { foo: "1.0.0" } }), "package.json");
    expect(r.imports.map((i) => i.module)).toContain("foo");
    expect(r.symbols.find((s) => s.decorators.includes("package-name"))).toBeUndefined();
  });

  it("attributes line numbers to the matching dep value", () => {
    const src = `{
      "name": "x",
      "dependencies": {
        "alpha": "1",
        "beta": "2"
      }
    }`;
    const r = ext.extract(null, src, "package.json");
    const alpha = r.imports.find((i) => i.module === "alpha")!;
    const beta = r.imports.find((i) => i.module === "beta")!;
    expect(alpha.line).toBeLessThan(beta.line);
    expect(alpha.line).toBeGreaterThan(1);
  });
});
