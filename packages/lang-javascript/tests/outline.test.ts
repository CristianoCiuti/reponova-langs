/**
 * Outline-pipeline tests for the JavaScript flavor. The outline implementation
 * is shared with `@reponova/lang-typescript` (covered exhaustively in the
 * `@reponova/lang-typescript-core` outline tests); here we assert that the
 * JS-grammar-driven outline correctly handles plain JS and JSX-bearing
 * source files.
 */
import { describe, it, expect } from "vitest";
import { plugin } from "../src/index.js";
import { loadGrammar } from "@reponova/lang-test-utils";
import type { SyntaxTree } from "reponova";

async function parse(source: string): Promise<SyntaxTree> {
  const loaded = await loadGrammar(plugin.grammarPath!);
  if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");
  return loaded.parse(source) as SyntaxTree;
}

describe("JavaScript outline (tree-sitter)", () => {
  it("extracts functions and class hierarchies from a JS module", async () => {
    const source = [
      "import { Component } from 'react';",
      "",
      "/** Functional button. */",
      "export function Button({ label }) {",
      "  return <button>{label}</button>;",
      "}",
      "",
      "/** Class-based button. */",
      "export class HeavyButton extends Component {",
      "  render() {",
      "    return <button data-heavy>{this.props.label}</button>;",
      "  }",
      "}",
    ].join("\n");

    const tree = await parse(source);
    const lineCount = source.split("\n").length;
    expect(plugin.outline?.treeSitterExtract).toBeDefined();
    const outline = plugin.outline!.treeSitterExtract!(tree.rootNode, "src/Button.jsx", lineCount);

    expect(outline.file_path).toBe("src/Button.jsx");
    expect(outline.line_count).toBe(lineCount);

    const functionNames = outline.functions.map((f) => f.name);
    expect(functionNames).toContain("Button");

    const classNames = outline.classes.map((c) => c.name);
    expect(classNames).toContain("HeavyButton");

    const heavy = outline.classes.find((c) => c.name === "HeavyButton");
    expect(heavy?.bases).toContain("Component");
    expect(heavy?.methods.map((m) => m.name)).toContain("render");

    expect(outline.imports.map((i) => i.module)).toContain("react");
  });

  it("extracts CommonJS modules with require() imports", async () => {
    const source = [
      "var fs = require('node:fs');",
      "function loadConfig(file) { return fs.readFileSync(file, 'utf8'); }",
      "module.exports = { loadConfig: loadConfig };",
    ].join("\n");

    const tree = await parse(source);
    const lineCount = source.split("\n").length;
    const outline = plugin.outline!.treeSitterExtract!(tree.rootNode, "src/config.cjs", lineCount);

    expect(outline.file_path).toBe("src/config.cjs");
    expect(outline.functions.map((f) => f.name)).toContain("loadConfig");
    expect(outline.imports.map((i) => i.module)).toContain("node:fs");
  });
});

describe("JavaScript outline (regex fallback)", () => {
  it("recovers a coarse outline when the WASM grammar is unavailable", () => {
    const source = [
      "import { Card } from './Card.jsx';",
      "",
      "export function Page() {",
      "  return <Card title=\"Home\" id=\"1\">Body</Card>;",
      "}",
      "",
      "export class App {",
      "  greet() { return 'hi'; }",
      "}",
    ].join("\n");
    const lineCount = source.split("\n").length;

    expect(plugin.outline?.regexExtract).toBeDefined();
    const outline = plugin.outline!.regexExtract("src/Page.jsx", source, lineCount);

    expect(outline.file_path).toBe("src/Page.jsx");
    expect(outline.functions.map((f) => f.name)).toContain("Page");
    expect(outline.classes.map((c) => c.name)).toContain("App");
    expect(outline.imports.map((i) => i.module)).toContain("./Card.jsx");
  });
});
