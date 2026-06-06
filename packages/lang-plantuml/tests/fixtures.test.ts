/**
 * Fixture-based tests for @reponova/lang-plantuml.
 *
 * Tiers:
 *  - simple/   : a 4-class diagram with 1 abstract type and 1 note
 *  - medium/   : a sequence diagram with alt branches, activations and notes
 *  - complex/  : 5 hand-authored real-world diagrams (class, sequence,
 *                component, state, C4 context).
 *
 * The extractor recognises:
 *   - class-diagram constructs (`class`, `interface`, `enum`,
 *     `abstract` / `abstract class`)
 *   - sequence-diagram nodes (`actor`, `participant`, `boundary`,
 *     `control`, `entity`, `collections`, `database`, `queue`)
 *   - state-diagram declarations (`state X`, `state "Display" as Alias`)
 *   - component-/deployment-diagram nodes (`component`, `cloud`, `node`,
 *     `database`, `queue`, `rectangle`, `frame`, `folder`, `package`)
 *   - the `[Foo]` bracket shorthand for inline components
 *   - C4-DSL macros (`Person`, `System`, `Container`, `SystemDb`,
 *     `ContainerDb`, …) plus their `_Ext` and `_Boundary` variants.
 *
 * Aliases win over display labels: `participant "Web UI" as UI` produces
 * a symbol named `UI` (so it joins arrows like `UI -> API`) with the
 * display label `Web UI` retained as the symbol's docstring.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PlantUmlExtractor } from "../src/index.js";
import { loadFixture } from "@reponova/lang-test-utils";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("simple/auth-classes.puml fixture", () => {
  it("extracts classes, abstract class, and the title as docstring", () => {
    const source = loadFixture(packageRoot, "simple/auth-classes.puml");
    const result = new PlantUmlExtractor().extract(null, source, "simple/auth-classes.puml");

    expect(result.fileNode.docstring).toBe("Authentication subsystem");

    const components = result.symbols.filter((s) => s.kind === "component").map((s) => s.name);
    expect(components).toContain("User");
    expect(components).toContain("Session");
    expect(components).toContain("Token");
    expect(components).toContain("Identity");
  });
});

describe("medium/order-flow.puml fixture", () => {
  it("captures sequence-diagram actors / participants / database via aliases", () => {
    const source = loadFixture(packageRoot, "medium/order-flow.puml");
    const result = new PlantUmlExtractor().extract(null, source, "medium/order-flow.puml");

    expect(result.fileNode.docstring).toBe("Order flow — checkout to fulfilment");
    expect(result.fileNode.kind).toBe("diagram");
    expect(result.fileNode.tags).toContain("plantuml");

    const names = result.symbols.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(["Customer", "UI", "API", "PSP", "INV", "MAIL", "DB"]),
    );

    const customer = result.symbols.find((s) => s.name === "Customer")!;
    expect(customer.decorators?.[0]).toBe("actor");

    const ui = result.symbols.find((s) => s.name === "UI")!;
    expect(ui.decorators?.[0]).toBe("participant");
    expect(ui.docstring).toBe("Web UI");

    const db = result.symbols.find((s) => s.name === "DB")!;
    expect(db.decorators?.[0]).toBe("database");
  });
});

describe("complex/ tier: 5 real-world diagrams", () => {
  const complexDir = resolve(packageRoot, "tests/fixtures/complex");

  it("every .puml file parses cleanly, has a title, is tagged, and emits ≥ 1 symbol", () => {
    const files = readdirSync(complexDir).filter((f) => f.endsWith(".puml")).sort();
    expect(files.length).toBe(5);

    const ext = new PlantUmlExtractor();
    for (const f of files) {
      const source = readFileSync(resolve(complexDir, f), "utf8");
      expect(() => ext.extract(null, source, `complex/${f}`), `${f}: should not throw`).not.toThrow();
      const result = ext.extract(null, source, `complex/${f}`);
      expect(result.fileNode.docstring, `${f}: missing title`).toBeTruthy();
      expect(result.fileNode.tags, `${f}: should be tagged plantuml`).toContain("plantuml");
      expect(result.symbols.length, `${f}: should emit ≥ 1 symbol`).toBeGreaterThan(0);
    }
  });

  it("domain-model.puml extracts class-diagram landmarks", () => {
    const source = readFileSync(resolve(complexDir, "domain-model.puml"), "utf8");
    const result = new PlantUmlExtractor().extract(null, source, "complex/domain-model.puml");

    const names = result.symbols.map((s) => s.name);
    for (const expected of ["User", "Organisation", "Subscription", "Plan", "Invoice", "Workspace", "Project", "Document"]) {
      expect(names, `expected ${expected} in domain model`).toContain(expected);
    }

    const interfaces = result.symbols.filter((s) => s.kind === "interface").map((s) => s.name);
    expect(interfaces).toContain("PriceCalculator");

    const enums = result.symbols.filter((s) => s.decorators?.[0] === "enum").map((s) => s.name);
    expect(enums).toContain("Role");
  });

  it("auth-sequence.puml extracts every actor / participant by alias", () => {
    const source = readFileSync(resolve(complexDir, "auth-sequence.puml"), "utf8");
    const result = new PlantUmlExtractor().extract(null, source, "complex/auth-sequence.puml");

    const names = result.symbols.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["RO", "UA", "CLI", "AS", "RS"]));

    expect(result.symbols.find((s) => s.name === "RO")?.decorators?.[0]).toBe("actor");
    expect(result.symbols.find((s) => s.name === "UA")?.decorators?.[0]).toBe("participant");
  });

  it("order-state.puml extracts every explicit state declaration", () => {
    const source = readFileSync(resolve(complexDir, "order-state.puml"), "utf8");
    const result = new PlantUmlExtractor().extract(null, source, "complex/order-state.puml");

    const names = result.symbols.map((s) => s.name);
    // Explicit `state X` and `state "Display" as Alias` declarations.
    expect(names).toEqual(
      expect.arrayContaining([
        "Draft",
        "AwaitingPayment",
        "A",
        "R",
        "Paid",
        "Picking",
        "Packed",
        "Shipped",
      ]),
    );
    // The `[*]` pseudostate is intentionally NOT a symbol.
    expect(names).not.toContain("*");
    // States that appear only on the right-hand side of a transition
    // (e.g. `Empty`, `Cancelled`, `Delivered`, `Closed`) are now
    // promoted as implicit-state symbols so that pure state-diagram
    // files written without standalone `state X` lines still produce
    // a useful graph.
    expect(names).toContain("Empty");
    expect(names).toContain("Cancelled");

    const implicitState = result.symbols.find((s) => s.name === "Empty");
    expect(implicitState?.kind).toBe("component");
    expect(implicitState?.decorators).toEqual(["state", "implicit"]);

    expect(result.symbols.find((s) => s.name === "A")?.docstring).toBe("Authorising");
  });

  it("service-components.puml extracts components, brackets, interfaces, databases and the queue", () => {
    const source = readFileSync(resolve(complexDir, "service-components.puml"), "utf8");
    const result = new PlantUmlExtractor().extract(null, source, "complex/service-components.puml");

    const names = result.symbols.map((s) => s.name);
    // Container nodes (cloud / node) by sanitised display label.
    expect(names).toEqual(
      expect.arrayContaining(["Public_Internet", "Edge", "Application_tier", "Data_tier"]),
    );
    // Bracket shorthand inside `cloud { ... }`.
    expect(names).toEqual(
      expect.arrayContaining(["Browser", "Mobile_App", "CDN", "API_Gateway"]),
    );
    // Component / database / queue / cloud aliases.
    expect(names).toEqual(
      expect.arrayContaining([
        "AUTH",
        "ORDER",
        "INV",
        "NOTIF",
        "AUTH_DB",
        "ORDER_DB",
        "INV_DB",
        "BUS",
        "S3",
      ]),
    );

    const interfaces = result.symbols.filter((s) => s.kind === "interface").map((s) => s.name);
    expect(interfaces).toEqual(expect.arrayContaining(["REST", "GRPC"]));
  });

  it("system-context.puml extracts actors, the platform rectangle, and every component / database", () => {
    const source = readFileSync(resolve(complexDir, "system-context.puml"), "utf8");
    const result = new PlantUmlExtractor().extract(null, source, "complex/system-context.puml");

    const names = result.symbols.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "cust",
        "host",
        "agent",
        "platform",
        "External",
        "web",
        "mob",
        "back",
        "api",
        "db",
        "psp",
        "mail",
        "maps",
        "idp",
      ]),
    );

    expect(result.symbols.find((s) => s.name === "cust")?.decorators?.[0]).toBe("actor");
    expect(result.symbols.find((s) => s.name === "platform")?.decorators?.[0]).toBe("rectangle");
    expect(result.symbols.find((s) => s.name === "db")?.decorators?.[0]).toBe("database");
  });
});
