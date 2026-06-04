import { describe, it, expect } from "vitest";
import { plugin, TypescriptExtractor } from "../src/index.js";
import { loadGrammar } from "@reponova/lang-test-utils";
import type { SyntaxTree } from "reponova";

describe("@reponova/lang-typescript plugin", () => {
  it("exports a valid LanguagePlugin", () => {
    expect(plugin.id).toBe("typescript");
    expect(plugin.extensions).toEqual([".ts", ".mts", ".cts"]);
    expect(plugin.grammarPath).toBeDefined();
    expect(plugin.extractor).toBeInstanceOf(TypescriptExtractor);
    expect(plugin.outline).toBeDefined();
  });

  it("extractor has correct metadata", () => {
    const ext = new TypescriptExtractor();
    expect(ext.languageId).toBe("typescript");
    expect(ext.extensions).toEqual([".ts", ".mts", ".cts"]);
    expect(ext.wasmFile).toBe("tree-sitter-typescript.wasm");
  });
});

describe("TypescriptExtractor.extract (requires tree-sitter)", () => {
  async function parse(source: string): Promise<SyntaxTree> {
    const loaded = await loadGrammar(plugin.grammarPath!);
    if (!loaded) throw new Error("grammar not available; run `pnpm grammar-fetch`");
    return loaded.parse(source) as SyntaxTree;
  }

  it("extracts a function with params, return type, and JSDoc", async () => {
    const source = [
      "/**",
      " * Greet a user by name.",
      " */",
      "export function greet(name: string): string {",
      "  return `Hello, ${name}`;",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const ext = new TypescriptExtractor();
    const result = ext.extract(tree, source, "src/greet.ts");

    expect(result.language).toBe("typescript");
    expect(result.fileNode.kind).toBe("module");
    expect(result.fileNode.label).toBe("greet.ts");

    const func = result.symbols.find((s) => s.name === "greet");
    expect(func?.kind).toBe("function");
    expect(func?.docstring).toBe("Greet a user by name.");
    expect(func?.signature).toContain("(name: string)");
    expect(func?.signature).toContain(": string");
    expect(result.exports).toContain("greet");
  });

  it("extracts a class with extends, methods, and decorators", async () => {
    const source = [
      "@Logger",
      "export abstract class Animal {",
      "  constructor(public name: string) {}",
      "  abstract speak(): string;",
      "}",
      "",
      "export class Dog extends Animal {",
      "  speak(): string {",
      "    return 'woof';",
      "  }",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const ext = new TypescriptExtractor();
    const result = ext.extract(tree, source, "src/animals.ts");

    const animal = result.symbols.find((s) => s.name === "Animal");
    expect(animal?.kind).toBe("class");
    expect(animal?.decorators).toContain("Logger");

    const dog = result.symbols.find((s) => s.name === "Dog");
    expect(dog?.kind).toBe("class");
    expect(dog?.bases).toContain("Animal");

    const methods = result.symbols.filter((s) => s.kind === "method").map((s) => s.name);
    expect(methods).toContain("constructor");
    expect(methods).toContain("speak");

    const extendsRef = result.references.find(
      (r) => r.kind === "extends" && r.name === "Animal",
    );
    expect(extendsRef).toBeDefined();
  });

  it("extracts interfaces, type aliases, and enums", async () => {
    const source = [
      "export interface Repository<T> extends Iterable<T> {",
      "  find(id: string): T | null;",
      "}",
      "export type ID = string | number;",
      "export enum Status { Open, Closed }",
    ].join("\n");
    const tree = await parse(source);
    const ext = new TypescriptExtractor();
    const result = ext.extract(tree, source, "src/repo.ts");

    const iface = result.symbols.find((s) => s.kind === "interface" && s.name === "Repository");
    expect(iface).toBeDefined();
    expect(iface?.bases).toContain("Iterable");

    const alias = result.symbols.find((s) => s.kind === "type" && s.name === "ID");
    expect(alias).toBeDefined();

    const enumSym = result.symbols.find((s) => s.kind === "enum" && s.name === "Status");
    expect(enumSym).toBeDefined();

    const exportNames = result.exports ?? [];
    expect(exportNames).toContain("Repository");
    expect(exportNames).toContain("ID");
    expect(exportNames).toContain("Status");
  });

  it("extracts arrow function declarations as functions", async () => {
    const source = [
      "export const add = (a: number, b: number): number => a + b;",
      "const helper = () => format(value);",
    ].join("\n");
    const tree = await parse(source);
    const ext = new TypescriptExtractor();
    const result = ext.extract(tree, source, "src/util.ts");

    const add = result.symbols.find((s) => s.name === "add");
    expect(add?.kind).toBe("function");
    expect(add?.signature).toContain("(a: number, b: number)");

    const helper = result.symbols.find((s) => s.name === "helper");
    expect(helper?.kind).toBe("function");

    const callRef = result.references.find((r) => r.name === "format" && r.kind === "calls");
    expect(callRef).toBeDefined();
  });

  it("extracts UPPER_SNAKE_CASE constants but ignores camelCase", async () => {
    const source = [
      "export const MAX_RETRIES = 3;",
      "export const DEFAULT_TIMEOUT_MS = 30_000;",
      "const userCount = 42;",
    ].join("\n");
    const tree = await parse(source);
    const ext = new TypescriptExtractor();
    const result = ext.extract(tree, source, "src/config.ts");

    const constants = result.symbols.filter((s) => s.kind === "constant").map((s) => s.name);
    expect(constants).toContain("MAX_RETRIES");
    expect(constants).toContain("DEFAULT_TIMEOUT_MS");
    expect(constants).not.toContain("userCount");
  });

  it("extracts default, named, namespace, and side-effect imports", async () => {
    const source = [
      "import express from 'express';",
      "import { readFile, writeFile as wf } from 'node:fs/promises';",
      "import * as path from 'node:path';",
      "import './polyfills';",
      "import type { Config } from './types';",
    ].join("\n");
    const tree = await parse(source);
    const ext = new TypescriptExtractor();
    const result = ext.extract(tree, source, "src/app.ts");

    expect(result.imports.length).toBe(5);

    const expressImp = result.imports.find((i) => i.module === "express");
    expect(expressImp?.names).toContain("express");

    const fsImp = result.imports.find((i) => i.module === "node:fs/promises");
    expect(fsImp?.names).toContain("readFile");
    expect(fsImp?.names).toContain("writeFile");

    const pathImp = result.imports.find((i) => i.module === "node:path");
    expect(pathImp?.isWildcard).toBe(true);

    const sideEffect = result.imports.find((i) => i.module === "./polyfills");
    expect(sideEffect?.names).toEqual([]);

    const typeImp = result.imports.find((i) => i.module === "./types");
    expect(typeImp?.names).toContain("Config");
  });

  it("captures re-exports as imports with isExport=true", async () => {
    const source = [
      "export { foo, bar } from './siblings';",
      "export * from './all';",
      "export * as ns from './ns';",
    ].join("\n");
    const tree = await parse(source);
    const ext = new TypescriptExtractor();
    const result = ext.extract(tree, source, "src/index.ts");

    expect(result.imports.length).toBe(3);
    for (const i of result.imports) expect(i.isExport).toBe(true);

    const named = result.imports.find((i) => i.module === "./siblings");
    expect(named?.names).toContain("foo");
    expect(named?.names).toContain("bar");

    const wild = result.imports.find((i) => i.module === "./all");
    expect(wild?.isWildcard).toBe(true);

    const ns = result.imports.find((i) => i.module === "./ns");
    expect(ns?.isWildcard).toBe(true);
  });

  it("captures class fields including readonly / static / private modifiers", async () => {
    // Class fields were previously dropped on the floor — only
    // method_definition was handled. They are extremely common in
    // real-world TS classes (DI tokens, configuration values, etc.)
    // and now surface as `variable` symbols hung under their class.
    const source = [
      "export class HttpClient {",
      "  private readonly baseUrl: string;",
      "  static defaultTimeoutMs = 30_000;",
      "  public retries: number = 3;",
      "  constructor(baseUrl: string) {",
      "    this.baseUrl = baseUrl;",
      "  }",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const ext = new TypescriptExtractor();
    const result = ext.extract(tree, source, "src/http.ts");

    const baseUrl = result.symbols.find((s) => s.name === "baseUrl");
    expect(baseUrl?.kind).toBe("variable");
    expect(baseUrl?.parent).toBe("HttpClient");
    expect(baseUrl?.decorators).toContain("private");
    expect(baseUrl?.decorators).toContain("readonly");

    const timeout = result.symbols.find((s) => s.name === "defaultTimeoutMs");
    expect(timeout?.parent).toBe("HttpClient");
    expect(timeout?.decorators).toContain("static");

    const retries = result.symbols.find((s) => s.name === "retries");
    expect(retries?.decorators).toContain("public");
  });

  it("marks getters and setters with `getter` / `setter` decorators", async () => {
    const source = [
      "export class Counter {",
      "  private _value = 0;",
      "  get value(): number { return this._value; }",
      "  set value(v: number) { this._value = v; }",
      "  bump(): void { this._value += 1; }",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const ext = new TypescriptExtractor();
    const result = ext.extract(tree, source, "src/counter.ts");

    const getter = result.symbols.find(
      (s) => s.name === "value" && (s.decorators ?? []).includes("getter"),
    );
    const setter = result.symbols.find(
      (s) => s.name === "value" && (s.decorators ?? []).includes("setter"),
    );
    expect(getter).toBeDefined();
    expect(setter).toBeDefined();
    const bump = result.symbols.find((s) => s.name === "bump");
    expect(bump?.decorators ?? []).not.toContain("getter");
    expect(bump?.decorators ?? []).not.toContain("setter");
  });

  it("marks async functions and methods with the `async` decorator", async () => {
    const source = [
      "export async function fetchData(url: string): Promise<string> {",
      "  return '';",
      "}",
      "",
      "export const fetchAlt = async (url: string) => '';",
      "",
      "export class Worker {",
      "  async run(): Promise<void> {}",
      "  stop(): void {}",
      "  async *stream(): AsyncIterable<number> { yield 1; }",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const ext = new TypescriptExtractor();
    const result = ext.extract(tree, source, "src/async.ts");

    const fetchFn = result.symbols.find((s) => s.name === "fetchData")!;
    expect(fetchFn.decorators).toContain("async");
    const fetchAlt = result.symbols.find((s) => s.name === "fetchAlt")!;
    expect(fetchAlt.decorators).toContain("async");
    const run = result.symbols.find((s) => s.name === "run")!;
    expect(run.decorators).toContain("async");
    const stop = result.symbols.find((s) => s.name === "stop")!;
    expect(stop.decorators ?? []).not.toContain("async");
    const stream = result.symbols.find((s) => s.name === "stream")!;
    expect(stream.decorators).toContain("async");
    expect(stream.decorators).toContain("generator");
  });

  it("promotes any exported `const` to a graph symbol, keeps lowercase locals hidden", async () => {
    // `export const userService = createUserService()` is the canonical
    // DI / module-singleton pattern and used to be silently dropped
    // because the extractor only kept UPPER_SNAKE_CASE bindings.
    const source = [
      "export const userService = createUserService();",
      "export const config = { retries: 3 };",
      "export const MAX_RETRIES = 3;",
      "const internalCache = new Map();",
      "const helper = () => 'x';",
    ].join("\n");
    const tree = await parse(source);
    const ext = new TypescriptExtractor();
    const result = ext.extract(tree, source, "src/services.ts");

    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("userService");
    expect(names).toContain("config");
    expect(names).toContain("MAX_RETRIES");
    // Internal lowercase non-arrow bindings stay hidden.
    expect(names).not.toContain("internalCache");
    // Internal arrow functions are still captured (existing behaviour).
    expect(names).toContain("helper");

    expect(result.exports).toContain("userService");
    expect(result.exports).toContain("config");
    expect(result.exports).toContain("MAX_RETRIES");
  });

  it("dedupes function and method overload signatures, keeping the implementation", async () => {
    // Overloads are a normal TS pattern: signatures-without-body for the
    // declarations, followed by one signature-with-body for the actual
    // implementation. Graph consumers should see exactly one symbol per
    // function name; we keep the implementation (last occurrence).
    const source = [
      "export function format(x: number): string;",
      "export function format(x: string): string;",
      "export function format(x: number | string): string {",
      "  return String(x);",
      "}",
      "",
      "export class Repo {",
      "  find(id: number): string;",
      "  find(id: string): string;",
      "  find(id: number | string): string {",
      "    return String(id);",
      "  }",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const ext = new TypescriptExtractor();
    const result = ext.extract(tree, source, "src/overloads.ts");

    const formatSyms = result.symbols.filter((s) => s.name === "format");
    expect(formatSyms.length).toBe(1);
    // The retained symbol must be the implementation: its signature
    // mentions the union return type (only the impl uses it).
    expect(formatSyms[0]?.signature).toContain("number | string");

    const findSyms = result.symbols.filter(
      (s) => s.name === "find" && s.parent === "Repo",
    );
    expect(findSyms.length).toBe(1);
    expect(findSyms[0]?.signature).toContain("number | string");
  });

  it("captures call references inside function bodies", async () => {
    const source = [
      "function load() {",
      "  const data = readFile('config.json');",
      "  return parse(data);",
      "}",
    ].join("\n");
    const tree = await parse(source);
    const ext = new TypescriptExtractor();
    const result = ext.extract(tree, source, "src/loader.ts");

    const calls = result.references.filter((r) => r.kind === "calls").map((r) => r.name);
    expect(calls).toContain("readFile");
    expect(calls).toContain("parse");
  });
});
