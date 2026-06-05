/**
 * TSX-specific extractor tests. The shared extractor logic is exhaustively
 * covered in `@reponova/lang-typescript-core`; these tests focus on
 * scenarios that ONLY make sense for the TSX flavor: JSX components, hook
 * calls, fragments, and component-as-value usage that the TS grammar
 * cannot parse.
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

describe("TSX extractor: function components", () => {
  it("extracts a functional component declared with `function`", async () => {
    const source = [
      "import { useState } from 'react';",
      "",
      "/** Button component. */",
      "export function Button({ label }: { label: string }) {",
      "  return <button>{label}</button>;",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/Button.tsx");

    expect(result.language).toBe("tsx");
    expect(result.fileNode.kind).toBe("module");
    expect(result.fileNode.label).toBe("Button.tsx");

    const button = result.symbols.find((s) => s.name === "Button");
    expect(button).toBeDefined();
    expect(button?.kind).toBe("function");
    expect(button?.docstring).toBe("Button component.");
    expect(result.exports).toContain("Button");
  });

  it("extracts an arrow-function component (`const Component = () => <…/>`)", async () => {
    const source = [
      "import { ReactNode } from 'react';",
      "",
      "export const Wrapper = ({ children }: { children: ReactNode }) => (",
      "  <div className=\"wrapper\">{children}</div>",
      ");",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/Wrapper.tsx");

    const wrapper = result.symbols.find((s) => s.name === "Wrapper");
    expect(wrapper?.kind).toBe("function");
    expect(result.exports).toContain("Wrapper");
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
    const result = extractor.extract(tree, source, "src/Timer.tsx");

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
      "import { Card } from './Card.js';",
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
    const result = extractor.extract(tree, source, "src/Page.tsx");

    const pageCalls = result.references
      .filter((ref) => ref.kind === "calls" && ref.fromSymbol === "src.Page.Page")
      .map((ref) => ref.name);
    expect(pageCalls).toContain("Card");
  });
});

describe("TSX extractor: class components", () => {
  it("extracts a class component with state and lifecycle methods", async () => {
    const source = [
      "import { Component } from 'react';",
      "",
      "interface Props { name: string }",
      "interface State { greeted: boolean }",
      "",
      "export class Hello extends Component<Props, State> {",
      "  state: State = { greeted: false };",
      "  componentDidMount(): void { this.setState({ greeted: true }); }",
      "  render() {",
      "    return <h1>Hello, {this.props.name}!</h1>;",
      "  }",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/Hello.tsx");

    const hello = result.symbols.find((s) => s.kind === "class" && s.name === "Hello");
    expect(hello).toBeDefined();
    expect(hello?.bases).toContain("Component");

    const methodNames = result.symbols
      .filter((s) => s.kind === "method" && s.parent === "Hello")
      .map((s) => s.name)
      .sort();
    expect(methodNames).toContain("componentDidMount");
    expect(methodNames).toContain("render");
  });
});

describe("TSX extractor: imports", () => {
  it("preserves bare React imports as imports without resolving to disk", async () => {
    const source = [
      "import { useState, type ReactNode } from 'react';",
      "import type { ComponentProps } from 'react';",
      "import * as ReactDOM from 'react-dom';",
      "",
      "export const x = useState(0);",
      "export type N = ReactNode;",
      "export type CP = ComponentProps<'div'>;",
      "export const dom = ReactDOM;",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/api.tsx");

    const modules = result.imports.map((i) => i.module).sort();
    expect(modules).toContain("react");
    expect(modules).toContain("react-dom");
  });

  it("captures `export … from './path.js'` re-exports with isExport flag", async () => {
    const source = [
      "export { Card, CompactCard } from './Card.js';",
      "export type { CardProps } from './Card.js';",
      "export * from './utils.js';",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/index.tsx");

    const reExports = result.imports.filter((i) => i.isExport);
    expect(reExports.length).toBeGreaterThan(0);
    const reModules = reExports.map((i) => i.module);
    expect(reModules).toContain("./Card.js");
    expect(reModules).toContain("./utils.js");
  });
});

describe("TSX extractor: JSX edge cases", () => {
  it("does not mistake JSX-only files for empty modules", async () => {
    const source = [
      "import { Fragment } from 'react';",
      "",
      "export const Layout = () => (",
      "  <Fragment>",
      "    <header><h1>Title</h1></header>",
      "    <main>",
      "      <ul>",
      "        {[1, 2, 3].map((n) => <li key={n}>{n}</li>)}",
      "      </ul>",
      "    </main>",
      "  </Fragment>",
      ");",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/Layout.tsx");

    expect(result.symbols.length).toBeGreaterThan(0);
    const layout = result.symbols.find((s) => s.name === "Layout");
    expect(layout?.kind).toBe("function");
  });

  it("handles fragment shorthand `<>…</>` without crashing", async () => {
    const source = [
      "export function Group({ items }: { items: string[] }) {",
      "  return <>{items.map((s) => <span key={s}>{s}</span>)}</>;",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const result = extractor.extract(tree, source, "src/Group.tsx");

    expect(result.symbols.find((s) => s.name === "Group")?.kind).toBe("function");
  });
});
