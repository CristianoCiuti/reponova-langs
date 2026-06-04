/**
 * Fixture-based tests for @reponova/lang-plantuml.
 *
 * Tiers (per INTEGRATION-PLAN.md §8.7):
 *  - simple/   : a 4-class diagram with 1 abstract type and 1 note
 *  - medium/   : a sequence diagram with alt branches, activations and notes
 *  - complex/  : 5 hand-authored real-world diagrams (class, sequence,
 *                component, state, C4 context).
 *
 * Known extractor scope (v0.2.x):
 *   The current PlantUML extractor recognises class-diagram constructs
 *   (`class`, `interface`, `enum`, `abstract` / `abstract class`) plus the
 *   `title` directive. It deliberately does NOT yet recognise:
 *     - sequence-diagram `actor` / `participant ... as ...`
 *     - state-diagram `state ...` / `[*]` transitions
 *     - component-diagram `component`/`cloud`/`node`/`database`/`queue`/
 *       `rectangle` keywords
 *     - C4-style `Person` / `System` / `Container` macros
 *   The complex/ fixtures intentionally cover those diagram families so
 *   that, when the extractor is later extended, the regression surface is
 *   already in place. For now, these tests assert the **invariants that
 *   hold today** (no crashes, title extraction, diagram tag, class-style
 *   landmark coverage).
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
  it("parses without crashing and captures the title", () => {
    const source = loadFixture(packageRoot, "medium/order-flow.puml");
    const result = new PlantUmlExtractor().extract(null, source, "medium/order-flow.puml");

    expect(result.fileNode.docstring).toBe("Order flow — checkout to fulfilment");
    expect(result.fileNode.kind).toBe("diagram");
    expect(result.fileNode.tags).toContain("plantuml");
    // Sequence-diagram participants are not yet recognised by the extractor;
    // see the "known extractor scope" note at the top of this file.
    expect(result.symbols.length).toBe(0);
  });
});

describe("complex/ tier: 5 real-world diagrams", () => {
  const complexDir = resolve(packageRoot, "tests/fixtures/complex");

  it("every .puml file parses cleanly, has a title, and is tagged as plantuml", () => {
    const files = readdirSync(complexDir).filter((f) => f.endsWith(".puml")).sort();
    expect(files.length).toBe(5);

    const ext = new PlantUmlExtractor();
    for (const f of files) {
      const source = readFileSync(resolve(complexDir, f), "utf8");
      expect(() => ext.extract(null, source, `complex/${f}`), `${f}: should not throw`).not.toThrow();
      const result = ext.extract(null, source, `complex/${f}`);
      expect(result.fileNode.docstring, `${f}: missing title`).toBeTruthy();
      expect(result.fileNode.tags, `${f}: should be tagged plantuml`).toContain("plantuml");
    }
  });

  it("domain-model.puml extracts class-diagram landmarks (the supported subset)", () => {
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

  it("non-class diagrams parse but emit (almost) zero symbols (extractor scope limitation)", () => {
    // These fixtures intentionally exercise diagram families the extractor
    // does not yet handle. The test pins the current behaviour so a future
    // PR that adds support can flip these expectations.
    const ext = new PlantUmlExtractor();
    for (const f of ["auth-sequence.puml", "order-state.puml", "system-context.puml"]) {
      const source = readFileSync(resolve(complexDir, f), "utf8");
      const result = ext.extract(null, source, `complex/${f}`);
      expect(result.symbols.length, `${f}: expected 0 symbols today`).toBe(0);
      expect(result.fileNode.docstring, `${f}: should still capture title`).toBeTruthy();
    }
  });

  it("service-components.puml: extractor only catches `interface` declarations today", () => {
    // The component diagram declares two `interface` boundaries (REST, gRPC)
    // alongside many unrecognised keywords (component/cloud/node/database).
    // The current regex only matches the interface lines.
    const source = readFileSync(resolve(complexDir, "service-components.puml"), "utf8");
    const result = new PlantUmlExtractor().extract(null, source, "complex/service-components.puml");

    const interfaces = result.symbols.filter((s) => s.kind === "interface").map((s) => s.name);
    expect(interfaces).toContain("REST");
    expect(interfaces).toContain("gRPC");
  });
});
