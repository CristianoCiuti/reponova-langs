/**
 * JavaScript-specific extractor tests. The shared extractor logic is
 * exhaustively covered in `@reponova/lang-typescript-core`; these tests
 * focus on scenarios that ONLY make sense for the JS flavor:
 *
 *   - CommonJS `require()` and `module.exports` / `exports.foo = …`
 *   - dialect mixing (.js + .mjs + .cjs + .jsx in the same project)
 *   - JSX through the JS grammar (no separate `tree-sitter-jsx`)
 *   - prototype-based class semantics that Express-style code uses
 *
 * What we do NOT re-test here: type-only imports, interfaces, generics,
 * decorators, enum declarations — none of those exist in the JavaScript
 * AST, so the corresponding branches of the shared extractor are no-ops.
 */
import { describe, it, expect } from "vitest";
import { plugin } from "../src/index.js";
import { type TypescriptExtractor } from "@reponova/lang-typescript-core";
import { loadGrammar } from "@reponova/lang-test-utils";
import type { SyntaxTree } from "reponova";

async function parse(source: string): Promise<SyntaxTree> {
  const loaded = await loadGrammar(plugin.grammarPath!);
  if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");
  return loaded.parse(source) as SyntaxTree;
}

const extractor = plugin.extractor as TypescriptExtractor;

describe("JavaScript extractor: ES module function declarations", () => {
  it("extracts a `function` declaration with JSDoc", async () => {
    const source = [
      "import { EventEmitter } from 'node:events';",
      "",
      "/** Builds an emitter pre-seeded with `initial`. */",
      "export function createCounter(initial = 0, step = 1) {",
      "  const e = new EventEmitter();",
      "  return e;",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/Counter.js");

    expect(result.language).toBe("javascript");
    expect(result.fileNode.kind).toBe("module");
    expect(result.fileNode.label).toBe("Counter.js");

    const fn = result.symbols.find((s) => s.name === "createCounter");
    expect(fn).toBeDefined();
    expect(fn?.kind).toBe("function");
    expect(fn?.docstring).toMatch(/Builds an emitter/);
    expect(result.exports).toContain("createCounter");
  });

  it("extracts an arrow-function exported as `export const`", async () => {
    const source = [
      "export const sum = (a, b) => a + b;",
      "export const greet = name => `hi ${name}`;",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/utils.js");

    const sum = result.symbols.find((s) => s.name === "sum");
    expect(sum?.kind).toBe("function");
    expect(result.exports).toContain("sum");
    expect(result.exports).toContain("greet");
  });

  it("captures async + generator modifiers as decorators", async () => {
    const source = [
      "export async function load() { return 42; }",
      "export function* eachItem() { yield 1; yield 2; }",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/iter.js");

    const load = result.symbols.find((s) => s.name === "load");
    expect(load?.decorators).toContain("async");
    const each = result.symbols.find((s) => s.name === "eachItem");
    expect(each?.decorators).toContain("generator");
  });
});

describe("JavaScript extractor: CommonJS dialect", () => {
  it("captures `require()` calls as imports", async () => {
    const source = [
      "var fs = require('node:fs');",
      "var { resolve } = require('node:path');",
      "var lodash = require('lodash');",
      "module.exports = { fs: fs };",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/legacy.cjs");

    const modules = result.imports.map((i) => i.module).sort();
    expect(modules).toContain("node:fs");
    expect(modules).toContain("node:path");
    expect(modules).toContain("lodash");
  });

  it("treats `function` declarations in CJS the same as ESM", async () => {
    const source = [
      "'use strict';",
      "var path = require('node:path');",
      "function loadConfig(file) {",
      "  return path.resolve(file);",
      "}",
      "module.exports = { loadConfig: loadConfig };",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/config.cjs");

    const fn = result.symbols.find((s) => s.name === "loadConfig");
    expect(fn?.kind).toBe("function");
    const calls = result.references
      .filter((r) => r.kind === "calls" && r.fromSymbol === "src.config.loadConfig")
      .map((r) => r.name);
    expect(calls.some((c) => c.endsWith("resolve") || c === "path.resolve")).toBe(true);
  });

  it("preserves the .cjs file kind as `module`", async () => {
    const source = "module.exports = function() {};";
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/factory.cjs");
    expect(result.fileNode.kind).toBe("module");
    expect(result.fileNode.label).toBe("factory.cjs");
    expect(result.language).toBe("javascript");
  });
});

describe("JavaScript extractor: classes", () => {
  it("extracts a class with constructor and methods", async () => {
    const source = [
      "import { Component } from 'react';",
      "",
      "export class Counter extends Component {",
      "  constructor(props) { super(props); this.state = { n: 0 }; }",
      "  increment() { this.setState({ n: this.state.n + 1 }); }",
      "  render() { return null; }",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/Counter.js");

    const cls = result.symbols.find((s) => s.kind === "class" && s.name === "Counter");
    expect(cls).toBeDefined();
    expect(cls?.bases).toContain("Component");

    const methods = result.symbols
      .filter((s) => s.kind === "method" && s.parent === "Counter")
      .map((s) => s.name)
      .sort();
    expect(methods).toContain("constructor");
    expect(methods).toContain("increment");
    expect(methods).toContain("render");
  });

  it("captures static class fields as variable symbols with the `static` decorator", async () => {
    const source = [
      "export class Modal {",
      "  static defaultProps = { kind: 'alert' };",
      "  static MAX_OPEN = 3;",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/Modal.js");

    const fields = result.symbols.filter(
      (s) => s.kind === "variable" && s.parent === "Modal",
    );
    expect(fields.map((f) => f.name).sort()).toEqual(["MAX_OPEN", "defaultProps"]);
    for (const f of fields) {
      expect(f.decorators).toContain("static");
    }
  });
});

describe("JavaScript extractor: JSX through tree-sitter-javascript", () => {
  it("extracts a functional component declared with `function`", async () => {
    const source = [
      "import { useState } from 'react';",
      "",
      "/** Button component. */",
      "export function Button({ label }) {",
      "  return <button>{label}</button>;",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/Button.jsx");

    const button = result.symbols.find((s) => s.name === "Button");
    expect(button).toBeDefined();
    expect(button?.kind).toBe("function");
    expect(button?.docstring).toBe("Button component.");
    expect(result.exports).toContain("Button");
    expect(result.fileNode.label).toBe("Button.jsx");
  });

  it("captures hook calls (useState, useEffect) inside a function component", async () => {
    const source = [
      "import { useState, useEffect } from 'react';",
      "",
      "export function Timer() {",
      "  const [seconds, setSeconds] = useState(0);",
      "  useEffect(() => {",
      "    const id = setInterval(() => setSeconds((s) => s + 1), 1000);",
      "    return () => clearInterval(id);",
      "  }, []);",
      "  return <span>{seconds}</span>;",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/Timer.jsx");

    const timerCalls = result.references
      .filter((ref) => ref.kind === "calls" && ref.fromSymbol === "src.Timer.Timer")
      .map((ref) => ref.name);
    expect(timerCalls).toContain("useState");
    expect(timerCalls).toContain("useEffect");
    expect(timerCalls).toContain("setInterval");
    expect(timerCalls).toContain("clearInterval");
  });

  it("captures JSX component usage as `calls` edges (`<ChildComponent />`)", async () => {
    const source = [
      "import { Card } from './Card.jsx';",
      "",
      "export function Page() {",
      "  return (",
      "    <main>",
      "      <Card title=\"Hello\" id=\"1\">",
      "        <p>Body</p>",
      "      </Card>",
      "    </main>",
      "  );",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/Page.jsx");

    const pageCalls = result.references
      .filter((ref) => ref.kind === "calls" && ref.fromSymbol === "src.Page.Page")
      .map((ref) => ref.name);
    expect(pageCalls).toContain("Card");
  });

  it("does not record lowercase JSX tags (e.g. `<div>`, `<button>`) as calls", async () => {
    const source = [
      "export function Plain() {",
      "  return <div><span>hi</span><button>x</button></div>;",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/Plain.jsx");

    const calls = result.references
      .filter((r) => r.kind === "calls" && r.fromSymbol === "src.Plain.Plain")
      .map((r) => r.name);
    expect(calls).not.toContain("div");
    expect(calls).not.toContain("span");
    expect(calls).not.toContain("button");
  });
});

describe("JavaScript extractor: imports and re-exports", () => {
  it("preserves bare React imports without resolving to disk", async () => {
    const source = [
      "import { useState } from 'react';",
      "import * as ReactDOM from 'react-dom';",
      "import 'core-js/stable';",
      "",
      "export const x = useState(0);",
      "export const dom = ReactDOM;",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/api.js");

    const modules = result.imports.map((i) => i.module).sort();
    expect(modules).toContain("react");
    expect(modules).toContain("react-dom");
    expect(modules).toContain("core-js/stable");
  });

  it("captures `export … from './path.jsx'` re-exports with isExport flag", async () => {
    const source = [
      "export { Card, CompactCard } from './Card.jsx';",
      "export * from './utils.js';",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/index.js");

    const reExports = result.imports.filter((i) => i.isExport);
    expect(reExports.length).toBeGreaterThan(0);
    const reModules = reExports.map((i) => i.module);
    expect(reModules).toContain("./Card.jsx");
    expect(reModules).toContain("./utils.js");
  });
});
