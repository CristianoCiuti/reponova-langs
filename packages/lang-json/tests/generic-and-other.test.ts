import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_GENERIC_KEYS, JsonExtractor } from "../src/index.js";

const ext = new JsonExtractor();

describe("extractor: generic JSON fallback", () => {
  it("surfaces top-level keys as variable symbols and the description as docstring", () => {
    const src = JSON.stringify({
      description: "a generic config",
      foo: 1,
      bar: { x: 2 },
      baz: [1, 2, 3],
    });
    const r = ext.extract(null, src, "config/options.json");
    expect(r.fileNode.docstring).toBe("a generic config");
    const keys = r.symbols.filter((s) => s.decorators.includes("json-key")).map((s) => s.name).sort();
    expect(keys).toEqual(["bar", "baz", "description", "foo"]);
  });

  it(`caps top-level key extraction at the default (${DEFAULT_MAX_GENERIC_KEYS}) to avoid graph explosion on data-style documents`, () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < DEFAULT_MAX_GENERIC_KEYS + 50; i++) obj[`key_${i}`] = i;
    const r = ext.extract(null, JSON.stringify(obj), "huge.json");
    const keys = r.symbols.filter((s) => s.decorators.includes("json-key"));
    expect(keys.length).toBe(DEFAULT_MAX_GENERIC_KEYS);
  });

  it("respects a custom maxGenericKeys passed via the constructor", () => {
    const tighter = new JsonExtractor({ maxGenericKeys: 10 });
    const obj: Record<string, number> = {};
    for (let i = 0; i < 25; i++) obj[`key_${i}`] = i;
    const r = tighter.extract(null, JSON.stringify(obj), "tight.json");
    const keys = r.symbols.filter((s) => s.decorators.includes("json-key"));
    expect(keys.length).toBe(10);
  });

  it("disables the cap when maxGenericKeys is Infinity", () => {
    const uncapped = new JsonExtractor({ maxGenericKeys: Number.POSITIVE_INFINITY });
    const obj: Record<string, number> = {};
    for (let i = 0; i < DEFAULT_MAX_GENERIC_KEYS + 50; i++) obj[`key_${i}`] = i;
    const r = uncapped.extract(null, JSON.stringify(obj), "no-cap.json");
    const keys = r.symbols.filter((s) => s.decorators.includes("json-key"));
    expect(keys.length).toBe(DEFAULT_MAX_GENERIC_KEYS + 50);
  });

  it("falls back to the default when maxGenericKeys is invalid (negative / NaN)", () => {
    const negative = new JsonExtractor({ maxGenericKeys: -5 });
    const nan = new JsonExtractor({ maxGenericKeys: Number.NaN });
    const obj: Record<string, number> = {};
    for (let i = 0; i < DEFAULT_MAX_GENERIC_KEYS + 5; i++) obj[`key_${i}`] = i;
    const src = JSON.stringify(obj);
    expect(
      negative.extract(null, src, "n.json").symbols.filter((s) => s.decorators.includes("json-key")).length,
    ).toBe(DEFAULT_MAX_GENERIC_KEYS);
    expect(
      nan.extract(null, src, "n.json").symbols.filter((s) => s.decorators.includes("json-key")).length,
    ).toBe(DEFAULT_MAX_GENERIC_KEYS);
  });

  it("does not crash on an empty document", () => {
    const r = ext.extract(null, "", "empty.json");
    expect(r.symbols).toEqual([]);
    expect(r.imports).toEqual([]);
    expect(r.fileNode.kind).toBe("module");
  });

  it("does not crash on a top-level scalar", () => {
    const r = ext.extract(null, JSON.stringify(42), "scalar.json");
    expect(r.symbols).toEqual([]);
  });

  it("does not crash on an unterminated JSONC document (recovery mode)", () => {
    const src = `{ "name": "broken", "scripts": { "build": "tsup"`;
    expect(() => ext.extract(null, src, "broken.json")).not.toThrow();
  });
});

describe("extractor: lerna.json", () => {
  it("surfaces the workspace globs as wildcard imports", () => {
    const src = JSON.stringify({
      version: "independent",
      packages: ["packages/*", "tools/*"],
    });
    const r = ext.extract(null, src, "lerna.json");
    expect(r.fileNode.tags).toEqual(expect.arrayContaining(["lerna", "monorepo"]));
    const ws = r.imports.filter((i) => i.isWildcard).map((i) => i.module).sort();
    expect(ws).toEqual(["packages/*", "tools/*"]);
  });
});

describe("extractor: turbo.json", () => {
  it("v1 `pipeline.*` becomes function symbols", () => {
    const src = JSON.stringify({
      $schema: "https://turbo.build/schema.json",
      pipeline: {
        build: { dependsOn: ["^build"], outputs: ["dist/**"] },
        test: { dependsOn: ["build"] },
        "deploy:prod": {},
      },
    });
    const r = ext.extract(null, src, "turbo.json");
    const tasks = r.symbols.filter((s) => s.decorators.includes("turbo-task")).map((s) => s.name).sort();
    expect(tasks).toEqual(["build", "deploy:prod", "test"]);
  });

  it("v2 `tasks.*` is treated identically", () => {
    const src = JSON.stringify({ tasks: { build: {}, lint: {} } });
    const r = ext.extract(null, src, "turbo.json");
    const tasks = r.symbols.filter((s) => s.decorators.includes("turbo-task")).map((s) => s.name).sort();
    expect(tasks).toEqual(["build", "lint"]);
  });

  it("`extends` (turbo 2 alpha) becomes an extends import", () => {
    const src = JSON.stringify({ extends: ["../base/turbo.json"], tasks: {} });
    const r = ext.extract(null, src, "turbo.json");
    const ext_ = r.imports.find((i) => i.names.includes("extends"));
    expect(ext_!.module).toBe("../base/turbo.json");
  });
});

describe("extractor: misc invariants", () => {
  it("the same input file path produces stable qualified names across runs", () => {
    const src = JSON.stringify({
      name: "x",
      scripts: { build: "a", test: "b" },
    });
    const r1 = ext.extract(null, src, "x/package.json");
    const r2 = ext.extract(null, src, "x/package.json");
    expect(r1.symbols.map((s) => s.qualifiedName)).toEqual(
      r2.symbols.map((s) => s.qualifiedName),
    );
  });

  it("multi-line line numbers track the AST faithfully", () => {
    const src = `{
  "name": "x",
  "version": "1.0.0",
  "scripts": {
    "alpha": "echo a",
    "beta": "echo b"
  }
}`;
    const r = ext.extract(null, src, "package.json");
    const alpha = r.symbols.find((s) => s.name === "alpha")!;
    const beta = r.symbols.find((s) => s.name === "beta")!;
    expect(alpha.startLine).toBe(5);
    expect(beta.startLine).toBe(6);
  });
});
