/**
 * Fixture-based tests covering the simple / medium / complex tiers.
 *
 * The complex/ tier is a SHA-pinned snapshot of `mermaid-js/mermaid-cli`
 * 11.15.0 `test-positive/*.mmd` (MIT). See
 * `tests/fixtures/complex/mermaid-cli-11.15.0/ATTRIBUTION.md` for provenance.
 *
 * Assertions on the complex tier are invariant-based per the language
 * plugin roadmap §5.4: parse-time budget, no throws, fileNode shape,
 * diagram-family detection counts and selected landmarks. They are NOT
 * an exact graph snapshot — upstream additions / formatting nits should
 * not break the gate.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MermaidExtractor } from "../src/index.js";
import { loadFixture } from "@reponova/lang-test-utils";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const complexRoot = resolve(packageRoot, "tests/fixtures/complex/mermaid-cli-11.15.0");

const ext = new MermaidExtractor();

describe("simple/auth-flow.mmd fixture", () => {
  it("captures frontmatter title, the decision diamond, and edges", () => {
    const source = loadFixture(packageRoot, "simple/auth-flow.mmd");
    const result = ext.extract(null, source, "simple/auth-flow.mmd");

    expect(result.fileNode.docstring).toBe("Login flow");
    expect(result.fileNode.tags).toEqual(["mermaid", "flowchart"]);

    const names = result.symbols.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(["Start", "Login", "Home", "LoginForm", "Auth"]),
    );

    const login = result.symbols.find((s) => s.name === "Login");
    expect(login?.decorators).toContain("diamond");
    const home = result.symbols.find((s) => s.name === "Home");
    expect(home?.decorators).toContain("rectangle");
    const start = result.symbols.find((s) => s.name === "Start");
    expect(start?.decorators).toContain("stadium");

    // Edges materialise as references.
    const edges = result.references.map((r) => `${r.fromSymbol.split(".").pop()}->${r.name}`);
    expect(edges).toEqual(expect.arrayContaining(["Start->Login", "Login->Home", "LoginForm->Auth"]));
  });
});

describe("medium/order-checkout.mmd fixture", () => {
  it("extracts all actors / participants by alias and captures the title", () => {
    const source = loadFixture(packageRoot, "medium/order-checkout.mmd");
    const result = ext.extract(null, source, "medium/order-checkout.mmd");

    expect(result.fileNode.docstring).toBe("Order checkout — payment + fulfilment");
    expect(result.fileNode.tags).toEqual(["mermaid", "sequence"]);

    const names = result.symbols.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["Cust", "UI", "API", "PSP", "INV", "DB"]));

    const cust = result.symbols.find((s) => s.name === "Cust");
    expect(cust?.decorators).toContain("actor");
    expect(cust?.docstring).toBe("Customer");

    const ui = result.symbols.find((s) => s.name === "UI");
    expect(ui?.decorators).toContain("participant");
    expect(ui?.docstring).toBe("Web UI");

    // At least the canonical happy-path arrows are present.
    const arrows = result.references.map((r) => `${r.fromSymbol.split(".").pop()}->${r.name}`);
    expect(arrows).toEqual(
      expect.arrayContaining(["Cust->UI", "UI->API", "API->PSP", "API->INV", "API->DB"]),
    );
  });
});

describe("medium/domain-model.mmd fixture", () => {
  it("extracts classes, members, an interface stereotype, and inheritance edges", () => {
    const source = loadFixture(packageRoot, "medium/domain-model.mmd");
    const result = ext.extract(null, source, "medium/domain-model.mmd");

    expect(result.fileNode.docstring).toBe("Billing domain model");
    expect(result.fileNode.tags).toEqual(["mermaid", "class"]);

    const classNames = result.symbols.filter((s) => s.kind === "class").map((s) => s.name);
    expect(classNames).toEqual(
      expect.arrayContaining(["Customer", "Subscription", "Plan", "Invoice", "InvoiceStatus"]),
    );

    const priceCalc = result.symbols.find((s) => s.name === "PriceCalculator");
    expect(priceCalc?.kind).toBe("interface");

    const id = result.symbols.find((s) => s.name === "id" && s.parent === "Customer");
    expect(id?.kind).toBe("variable");
    expect(id?.decorators).toContain("public");

    const cancel = result.symbols.find((s) => s.name === "cancel" && s.parent === "Subscription");
    expect(cancel?.kind).toBe("method");

    const inheritance = result.references.find(
      (r) => r.name === "PriceCalculator" && r.kind === "extends",
    );
    expect(inheritance).toBeDefined();
  });
});

describe("complex/ tier: mermaid-cli 11.15.0 test-positive snapshot", () => {
  function listMmdFiles(): string[] {
    return readdirSync(complexRoot)
      .filter((f) => f.endsWith(".mmd"))
      .sort();
  }

  it("includes 25 .mmd files from the upstream snapshot", () => {
    expect(listMmdFiles().length).toBe(25);
  });

  it("ships ATTRIBUTION.md + LICENSE alongside the fixture", () => {
    const entries = readdirSync(complexRoot);
    expect(entries).toContain("ATTRIBUTION.md");
    expect(entries).toContain("LICENSE");
  });

  it("every .mmd file parses without throwing and emits a valid fileNode", () => {
    const files = listMmdFiles();
    expect(files.length).toBeGreaterThan(0);

    const start = Date.now();
    for (const f of files) {
      const source = readFileSync(join(complexRoot, f), "utf8");
      expect(() => ext.extract(null, source, `complex/${f}`), `${f}: should not throw`).not.toThrow();
      const result = ext.extract(null, source, `complex/${f}`);
      expect(result.fileNode.kind, `${f}: fileNode.kind`).toBe("diagram");
      expect(result.fileNode.tags?.[0], `${f}: first tag`).toBe("mermaid");
      expect(result.language, `${f}: language`).toBe("diagram");
    }
    const elapsedMs = Date.now() - start;
    // Parse-time budget per §5.4: must be well under 5s for 25 small files.
    expect(elapsedMs, `complex tier parse-time budget`).toBeLessThan(5000);
  });

  it("detects the correct diagram family for landmark files", () => {
    const cases: Array<{ file: string; family: string }> = [
      { file: "flowchart1.mmd", family: "flowchart" },
      { file: "flowchart2.mmd", family: "flowchart" },
      { file: "flowchart-elk.mmd", family: "flowchart" },
      { file: "sequence.mmd", family: "sequence" },
      { file: "classDiagram-v2.mmd", family: "class" },
      { file: "state1.mmd", family: "state" },
      { file: "state2.mmd", family: "state" },
      { file: "git-graph.mmd", family: "gitGraph" },
      { file: "mindmap.mmd", family: "mindmap" },
      { file: "timeline.mmd", family: "timeline" },
      { file: "zenuml.mmd", family: "zenuml" },
    ];
    for (const { file, family } of cases) {
      const source = readFileSync(join(complexRoot, file), "utf8");
      const result = ext.extract(null, source, `complex/${file}`);
      expect(result.fileNode.tags, `${file}: tags`).toEqual(["mermaid", family]);
    }
  });

  it("flowchart1.mmd extracts every node id at least once", () => {
    const source = readFileSync(join(complexRoot, "flowchart1.mmd"), "utf8");
    const result = ext.extract(null, source, "complex/flowchart1.mmd");
    const names = result.symbols.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["A", "B", "C", "D", "E", "F"]));
  });

  it("classDiagram-v2.mmd captures the frontmatter title and both class blocks", () => {
    const source = readFileSync(join(complexRoot, "classDiagram-v2.mmd"), "utf8");
    const result = ext.extract(null, source, "complex/classDiagram-v2.mmd");
    expect(result.fileNode.docstring).toBe("Empty class diagram v2 structs");
    const classes = result.symbols.filter((s) => s.kind === "class").map((s) => s.name);
    expect(classes).toEqual(expect.arrayContaining(["Pancake", "Waffle"]));
  });

  it("git-graph.mmd captures the feature branch and at least 3 commits", () => {
    const source = readFileSync(join(complexRoot, "git-graph.mmd"), "utf8");
    const result = ext.extract(null, source, "complex/git-graph.mmd");
    const feature = result.symbols.find((s) => s.name === "feature");
    expect(feature?.decorators).toContain("branch");
    const commits = result.symbols.filter((s) => s.decorators.includes("commit"));
    expect(commits.length).toBeGreaterThanOrEqual(3);
  });

  it("mindmap.mmd preserves parent-child relationships through indentation", () => {
    const source = readFileSync(join(complexRoot, "mindmap.mmd"), "utf8");
    const result = ext.extract(null, source, "complex/mindmap.mmd");
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("root");
    expect(result.symbols.find((s) => s.decorators.includes("mindmap_node"))).toBeDefined();
    // At least one descendant points to a non-file parent.
    const withMindmapParent = result.symbols.filter((s) => s.parent && s.parent !== "mindmap.mmd");
    expect(withMindmapParent.length).toBeGreaterThan(0);
  });

  it("sequence.mmd promotes implicit participants from arrows", () => {
    const source = readFileSync(join(complexRoot, "sequence.mmd"), "utf8");
    const result = ext.extract(null, source, "complex/sequence.mmd");
    const names = result.symbols.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["ABCD", "DEE", "FGG", "HII"]));
    const implicit = result.symbols.filter((s) => s.decorators.includes("implicit"));
    expect(implicit.length).toBeGreaterThanOrEqual(4);
  });

  it("zenuml.mmd extracts @Actor + @Database annotators", () => {
    const source = readFileSync(join(complexRoot, "zenuml.mmd"), "utf8");
    const result = ext.extract(null, source, "complex/zenuml.mmd");
    const alice = result.symbols.find((s) => s.name === "Alice");
    const bob = result.symbols.find((s) => s.name === "Bob");
    expect(alice?.decorators).toContain("actor");
    expect(bob?.decorators).toContain("database");
  });

  it("aggregate counts across the snapshot are non-trivial", () => {
    let totalSymbols = 0;
    let totalReferences = 0;
    let fileNodes = 0;
    for (const f of listMmdFiles()) {
      const source = readFileSync(join(complexRoot, f), "utf8");
      const result = ext.extract(null, source, `complex/${f}`);
      totalSymbols += result.symbols.length;
      totalReferences += result.references.length;
      fileNodes += 1;
    }
    expect(fileNodes).toBe(25);
    // Across 25 files spanning 13+ families we should pull plenty of nodes
    // and a sane amount of edges even with conservative parsing.
    expect(totalSymbols).toBeGreaterThan(80);
    expect(totalReferences).toBeGreaterThan(30);
  });
});
