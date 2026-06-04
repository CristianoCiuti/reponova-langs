import { describe, it, expect } from "vitest";
import { plugin, PlantUmlExtractor } from "../src/index.js";

describe("@reponova/lang-plantuml plugin", () => {
  it("exports a valid LanguagePlugin", () => {
    expect(plugin.id).toBe("plantuml");
    expect(plugin.extensions).toEqual([".puml", ".plantuml"]);
    expect(plugin.grammarPath).toBeUndefined();
    expect(plugin.extractor).toBeInstanceOf(PlantUmlExtractor);
    expect(plugin.outline).toBeUndefined();
  });

  it("extractor has correct metadata", () => {
    const ext = new PlantUmlExtractor();
    expect(ext.languageId).toBe("plantuml");
    expect(ext.extensions).toEqual([".puml", ".plantuml"]);
    expect(ext.wasmFile).toBeUndefined();
  });

  it("resolveImportPath always returns empty", () => {
    const ext = new PlantUmlExtractor();
    expect(ext.resolveImportPath("anything", "file.puml")).toEqual([]);
  });
});

describe("PlantUmlExtractor.extract", () => {
  const ext = new PlantUmlExtractor();

  it("should extract classes and interfaces", () => {
    const source = `@startuml
title System Architecture
class ConfigLoader
class DataProcessor
interface OutputInterface
class FileOutput
ConfigLoader --> DataProcessor
DataProcessor --> OutputInterface
@enduml`;

    const result = ext.extract(null, source, "docs/arch.puml");

    expect(result.language).toBe("diagram");
    expect(result.fileNode.kind).toBe("diagram");
    expect(result.fileNode.tags).toContain("plantuml");
    expect(result.fileNode.docstring).toBe("System Architecture");

    const components = result.symbols.filter(s => s.kind === "component");
    expect(components.map(s => s.name)).toContain("ConfigLoader");
    expect(components.map(s => s.name)).toContain("DataProcessor");
    expect(components.map(s => s.name)).toContain("FileOutput");

    const interfaces = result.symbols.filter(s => s.kind === "interface");
    expect(interfaces.map(s => s.name)).toContain("OutputInterface");
  });

  it("should extract relationships as references", () => {
    const source = `@startuml
class A
class B
A --> B
@enduml`;

    const result = ext.extract(null, source, "rel.puml");
    expect(result.references.length).toBeGreaterThan(0);

    const ref = result.references.find(r => r.name === "B");
    expect(ref).toBeDefined();
    expect(ref!.fromSymbol).toContain("A");
    expect(ref!.kind).toBe("extends");
  });

  it("should handle abstract classes and enums", () => {
    const source = `@startuml
abstract class Base
enum Status
@enduml`;

    const result = ext.extract(null, source, "types.puml");
    const names = result.symbols.map(s => s.name);
    expect(names).toContain("Base");
    expect(names).toContain("Status");
  });

  it("should handle empty file", () => {
    const result = ext.extract(null, "", "empty.puml");
    expect(result.symbols).toHaveLength(0);
    expect(result.references).toHaveLength(0);
    expect(result.fileNode.kind).toBe("diagram");
  });

  it("should handle quoted names", () => {
    const source = `class "MyClass" as MC`;
    const result = ext.extract(null, source, "quoted.puml");
    // Regex captures 'MyClass' without quotes
    const names = result.symbols.map(s => s.name);
    expect(names).toContain("MyClass");
  });

  it("should compute qualifiedName from file path", () => {
    const source = `class Foo`;
    const result = ext.extract(null, source, "docs/diagrams/arch.puml");
    const foo = result.symbols.find(s => s.name === "Foo");
    expect(foo?.qualifiedName).toBe("docs.diagrams.arch.Foo");
  });
});
