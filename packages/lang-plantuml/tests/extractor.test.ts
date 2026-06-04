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

  it("should prefer the alias over the display label for quoted names", () => {
    // PlantUML uses the alias as the canonical identifier for arrows, so
    // `class "MyClass" as MC` followed by `MC --> Other` only resolves
    // when the symbol is named after the alias.
    const source = `class "MyClass" as MC`;
    const result = ext.extract(null, source, "quoted.puml");
    const names = result.symbols.map(s => s.name);
    expect(names).toContain("MC");
    const mc = result.symbols.find((s) => s.name === "MC")!;
    expect(mc.docstring).toBe("MyClass");
  });

  it("should compute qualifiedName from file path", () => {
    const source = `class Foo`;
    const result = ext.extract(null, source, "docs/diagrams/arch.puml");
    const foo = result.symbols.find(s => s.name === "Foo");
    expect(foo?.qualifiedName).toBe("docs.diagrams.arch.Foo");
  });

  it("extracts sequence-diagram actors and participants", () => {
    const source = `@startuml
actor Customer
participant "Web UI" as UI
participant "Order API" as API
database "Postgres" as DB
@enduml`;
    const result = ext.extract(null, source, "seq.puml");
    const byName = (n: string) => result.symbols.find((s) => s.name === n);

    expect(byName("Customer")?.decorators?.[0]).toBe("actor");
    expect(byName("UI")?.decorators?.[0]).toBe("participant");
    expect(byName("API")?.decorators?.[0]).toBe("participant");
    expect(byName("DB")?.decorators?.[0]).toBe("database");
    expect(byName("UI")?.docstring).toBe("Web UI");
  });

  it("extracts state-diagram declarations and skips the [*] pseudostate", () => {
    const source = `@startuml
[*] --> Draft
state Draft
state "Authorising" as A
state Paid
Paid --> [*]
@enduml`;
    const result = ext.extract(null, source, "state.puml");
    const names = result.symbols.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["Draft", "A", "Paid"]));
    expect(names).not.toContain("*");
    expect(result.symbols.find((s) => s.name === "A")?.docstring).toBe("Authorising");
  });

  it("extracts component-diagram nodes (component / cloud / node / database / queue / rectangle)", () => {
    const source = `@startuml
cloud "Public Internet" {
  [Browser]
  [Mobile App]
}
node "Edge" {
  [API Gateway]
}
component "Order Service" as ORDER
database "Order DB" as ORDER_DB
queue "Event Bus" as BUS
rectangle "Boundary" as BOUND
@enduml`;
    const result = ext.extract(null, source, "components.puml");
    const names = result.symbols.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Public_Internet",
        "Edge",
        "Browser",
        "Mobile_App",
        "API_Gateway",
        "ORDER",
        "ORDER_DB",
        "BUS",
        "BOUND",
      ]),
    );
    expect(result.symbols.find((s) => s.name === "Browser")?.decorators?.[0]).toBe("bracket");
    expect(result.symbols.find((s) => s.name === "ORDER")?.decorators?.[0]).toBe("component");
  });

  it("extracts C4-DSL macros (Person / System / Container / SystemDb)", () => {
    const source = `@startuml
Person(cust, "Customer", "Books trips")
Person_Ext(agent, "Travel Agent")
System(platform, "Booking Platform")
SystemDb(legacy, "Legacy Mainframe")
Container(api, "API")
ContainerDb(db, "Postgres")
@enduml`;
    const result = ext.extract(null, source, "c4.puml");
    const names = result.symbols.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(["cust", "agent", "platform", "legacy", "api", "db"]),
    );
    expect(result.symbols.find((s) => s.name === "cust")?.decorators?.[0]).toBe("c4_person");
    expect(result.symbols.find((s) => s.name === "agent")?.decorators?.[0]).toBe("c4_person_ext");
    expect(result.symbols.find((s) => s.name === "db")?.decorators?.[0]).toBe("c4_containerdb");
  });

  it("declaring a node twice (e.g. via shorthand and explicit) yields a single symbol", () => {
    const source = `@startuml
component "Browser" as Browser
[Browser]
@enduml`;
    const result = ext.extract(null, source, "dup.puml");
    const browsers = result.symbols.filter((s) => s.name === "Browser");
    expect(browsers.length).toBe(1);
  });
});
