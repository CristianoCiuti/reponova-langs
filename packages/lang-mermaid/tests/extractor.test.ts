import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MermaidExtractor, plugin } from "../src/index.js";

function readManifestExtensions(): string[] {
  const pkgJsonPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  return pkg.reponova?.extensions ?? [];
}

describe("@reponova/lang-mermaid plugin", () => {
  it("exports a valid LanguagePlugin", () => {
    expect(plugin.id).toBe("mermaid");
    expect(plugin.fileType).toBe("mermaid");
    expect(plugin.extractor).toBeInstanceOf(MermaidExtractor);
    expect(plugin.grammarPath).toBeUndefined();
    expect(plugin.configDefaults).toBeUndefined();
  });

  it("declares extensions in its manifest (authoritative source)", () => {
    expect(readManifestExtensions()).toEqual([".mmd", ".mermaid"]);
  });

  it("extractor has correct metadata", () => {
    const ext = new MermaidExtractor();
    expect(ext.languageId).toBe("mermaid");
    expect(ext.extensions).toEqual([".mmd", ".mermaid"]);
    expect(ext.wasmFile).toBeUndefined();
  });

  it("produces a fileNode of kind diagram even on empty input", () => {
    const ext = new MermaidExtractor();
    const result = ext.extract(null, "", "empty.mmd");
    expect(result.fileNode.kind).toBe("diagram");
    expect(result.language).toBe("diagram");
    expect(result.fileNode.tags).toEqual(["mermaid", "unknown"]);
    expect(result.symbols).toEqual([]);
    expect(result.imports).toEqual([]);
    expect(result.references).toEqual([]);
  });

  it("strips YAML frontmatter and captures the title", () => {
    const ext = new MermaidExtractor();
    const result = ext.extract(
      null,
      "---\ntitle: My diagram\n---\nflowchart TD\nA --> B\n",
      "x.mmd",
    );
    expect(result.fileNode.docstring).toBe("My diagram");
    expect(result.fileNode.tags).toEqual(["mermaid", "flowchart"]);
  });

  it("ignores %%{init: …}%% directives and %% comments", () => {
    const ext = new MermaidExtractor();
    const result = ext.extract(
      null,
      '%%{init: {"theme":"dark"}}%%\n%% top-level comment\nflowchart LR\n  A --> B\n',
      "x.mmd",
    );
    expect(result.fileNode.tags).toContain("flowchart");
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("A");
    expect(names).toContain("B");
  });

  it("captures inline title directive when no frontmatter is present", () => {
    const ext = new MermaidExtractor();
    const result = ext.extract(null, "sequenceDiagram\n    title My API\n    A->>B: hi\n", "x.mmd");
    expect(result.fileNode.docstring).toBe("My API");
  });
});

describe("MermaidExtractor — flowchart family", () => {
  it("extracts nodes by id and the basic shapes", () => {
    const ext = new MermaidExtractor();
    const source = [
      "flowchart TD",
      "    A[Rectangle] --> B(Rounded)",
      "    B --> C{Diamond}",
      "    C --> D((Circle))",
      "    C --> E{{Hexagon}}",
    ].join("\n");
    const result = ext.extract(null, source, "shapes.mmd");
    const byName = (n: string) => result.symbols.find((s) => s.name === n);

    expect(byName("A")?.decorators).toContain("rectangle");
    expect(byName("B")?.decorators).toContain("rounded");
    expect(byName("C")?.decorators).toContain("diamond");
    expect(byName("D")?.decorators).toContain("circle");
    expect(byName("E")?.decorators).toContain("hexagon");
  });

  it("emits edges as references", () => {
    const ext = new MermaidExtractor();
    const source = "flowchart LR\n    A --> B\n    B -.-> C\n    C ==> D\n";
    const result = ext.extract(null, source, "edges.mmd");
    const arrows = result.references.map((r) => `${r.fromSymbol.split(".").pop()}->${r.name}`);
    expect(arrows).toContain("A->B");
    expect(arrows).toContain("B->C");
    expect(arrows).toContain("C->D");
  });

  it("records subgraphs and their nested nodes", () => {
    const ext = new MermaidExtractor();
    const source = [
      "flowchart TD",
      "  subgraph svc [Application tier]",
      "    API[API]",
      "    DB[(Database)]",
      "  end",
      "  API --> DB",
    ].join("\n");
    const result = ext.extract(null, source, "subgraph.mmd");

    const sg = result.symbols.find((s) => s.name === "svc");
    expect(sg?.kind).toBe("module");
    expect(sg?.decorators).toContain("subgraph");
    expect(sg?.docstring).toBe("Application tier");

    const api = result.symbols.find((s) => s.name === "API");
    expect(api?.parent).toBe("svc");
    expect(api?.decorators).toContain("rectangle");

    const db = result.symbols.find((s) => s.name === "DB");
    expect(db?.parent).toBe("svc");
    expect(db?.decorators).toContain("cylinder");
  });

  it("recognises click-target node ids", () => {
    const ext = new MermaidExtractor();
    const result = ext.extract(
      null,
      'flowchart LR\n  click MyNode "https://example.org"\n',
      "click.mmd",
    );
    expect(result.symbols.find((s) => s.name === "MyNode")).toBeDefined();
  });
});

describe("MermaidExtractor — sequenceDiagram", () => {
  it("recognises actor + participant declarations with aliases", () => {
    const ext = new MermaidExtractor();
    const source = [
      "sequenceDiagram",
      '    actor "Bob the Customer" as Bob',
      '    participant "Web UI" as UI',
      "    Bob->>UI: place order",
      "    UI-->>Bob: confirmation",
    ].join("\n");
    const result = ext.extract(null, source, "seq.mmd");

    const bob = result.symbols.find((s) => s.name === "Bob");
    expect(bob?.decorators).toContain("actor");
    expect(bob?.docstring).toBe("Bob the Customer");

    const ui = result.symbols.find((s) => s.name === "UI");
    expect(ui?.decorators).toContain("participant");
    expect(ui?.docstring).toBe("Web UI");

    expect(result.references.length).toBeGreaterThanOrEqual(2);
  });

  it("promotes implicit participants from arrows when no explicit declaration exists", () => {
    const ext = new MermaidExtractor();
    const source = "sequenceDiagram\n  Alice->>Bob: hi\n  Bob-->>Alice: hello\n";
    const result = ext.extract(null, source, "implicit.mmd");
    const alice = result.symbols.find((s) => s.name === "Alice");
    expect(alice?.decorators).toContain("participant");
    expect(alice?.decorators).toContain("implicit");
  });
});

describe("MermaidExtractor — classDiagram", () => {
  it("extracts classes, methods, fields, and inheritance edges", () => {
    const ext = new MermaidExtractor();
    const source = [
      "classDiagram",
      "  class Animal {",
      "    +String name",
      "    +eat() void",
      "  }",
      "  class Dog {",
      "    +bark() void",
      "  }",
      "  Dog --|> Animal",
    ].join("\n");
    const result = ext.extract(null, source, "class.mmd");

    const animal = result.symbols.find((s) => s.name === "Animal");
    expect(animal?.kind).toBe("class");

    const eat = result.symbols.find((s) => s.name === "eat" && s.parent === "Animal");
    expect(eat?.kind).toBe("method");
    expect(eat?.decorators).toContain("public");

    const name = result.symbols.find((s) => s.name === "name" && s.parent === "Animal");
    expect(name?.kind).toBe("variable");

    const edge = result.references.find((r) => r.name === "Animal" && r.kind === "extends");
    expect(edge).toBeDefined();
  });

  it("captures <<interface>> / <<abstract>> stereotypes", () => {
    const ext = new MermaidExtractor();
    const source = [
      "classDiagram",
      "  class Repository",
      "  Repository : <<interface>>",
      "  Repository : +find(id) Entity",
    ].join("\n");
    const result = ext.extract(null, source, "iface.mmd");
    const repo = result.symbols.find((s) => s.name === "Repository");
    expect(repo?.kind).toBe("interface");
    expect(repo?.decorators).toContain("interface");
  });
});

describe("MermaidExtractor — stateDiagram", () => {
  it("emits explicit states + promotes endpoints to implicit states", () => {
    const ext = new MermaidExtractor();
    const source = [
      "stateDiagram-v2",
      '  state "Awaiting payment" as Awaiting',
      "  [*] --> Draft",
      "  Draft --> Awaiting",
      "  Awaiting --> Paid",
      "  Paid --> [*]",
    ].join("\n");
    const result = ext.extract(null, source, "state.mmd");
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("Awaiting");
    expect(names).toContain("Draft");
    expect(names).toContain("Paid");

    const implicit = result.symbols.find((s) => s.name === "Draft");
    expect(implicit?.decorators).toContain("implicit");

    expect(names).not.toContain("*");
  });

  it("records state stereotype (e.g. <<choice>>)", () => {
    const ext = new MermaidExtractor();
    const source = [
      "stateDiagram-v2",
      "  state Decide <<choice>>",
      "  A --> Decide",
      "  Decide --> B",
    ].join("\n");
    const result = ext.extract(null, source, "choice.mmd");
    const decide = result.symbols.find((s) => s.name === "Decide");
    expect(decide?.decorators).toContain("choice");
  });
});

describe("MermaidExtractor — erDiagram", () => {
  it("extracts entities, attributes, and relations", () => {
    const ext = new MermaidExtractor();
    const source = [
      "erDiagram",
      "  CUSTOMER {",
      "    string name",
      "    string email PK",
      "  }",
      "  ORDER {",
      "    int id",
      "  }",
      "  CUSTOMER ||--o{ ORDER : places",
    ].join("\n");
    const result = ext.extract(null, source, "er.mmd");

    const customer = result.symbols.find((s) => s.name === "CUSTOMER");
    expect(customer?.kind).toBe("class");
    expect(customer?.decorators).toContain("er_entity");

    const email = result.symbols.find((s) => s.name === "email");
    expect(email?.kind).toBe("variable");
    expect(email?.decorators).toContain("pk");

    expect(
      result.references.find((r) => r.name === "ORDER" && r.fromSymbol.endsWith("CUSTOMER")),
    ).toBeDefined();
  });
});

describe("MermaidExtractor — pie / gantt / journey / gitGraph / timeline", () => {
  it("extracts pie slices", () => {
    const ext = new MermaidExtractor();
    const source = ['pie title Browsers', '  "Chrome" : 60', '  "Firefox" : 25', '  "Safari" : 15'].join("\n");
    const result = ext.extract(null, source, "pie.mmd");
    const names = result.symbols.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["Chrome", "Firefox", "Safari"]));
  });

  it("extracts gantt sections + tasks", () => {
    const ext = new MermaidExtractor();
    const source = [
      "gantt",
      "  title Project",
      "  dateFormat YYYY-MM-DD",
      "  section Planning",
      "  Spec : a1, 2024-01-01, 5d",
      "  section Build",
      "  Backend : a2, after a1, 10d",
    ].join("\n");
    const result = ext.extract(null, source, "gantt.mmd");
    const tasks = result.symbols.filter((s) => s.decorators.includes("gantt_task"));
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    const sections = result.symbols.filter((s) => s.kind === "section");
    expect(sections.map((s) => s.name)).toEqual(expect.arrayContaining(["Planning", "Build"]));
  });

  it("extracts journey sections + tasks", () => {
    const ext = new MermaidExtractor();
    const source = [
      "journey",
      "  title Morning routine",
      "  section Get ready",
      "  Wake up: 3: Me",
      "  Brush teeth: 2: Me",
      "  section Commute",
      "  Bus: 1: Me, Driver",
    ].join("\n");
    const result = ext.extract(null, source, "journey.mmd");
    const tasks = result.symbols.filter((s) => s.decorators.includes("journey_task"));
    expect(tasks.length).toBeGreaterThanOrEqual(3);
  });

  it("extracts gitGraph commits + branches", () => {
    const ext = new MermaidExtractor();
    const source = [
      "gitGraph",
      "  commit id: \"first\"",
      "  branch feature",
      "  commit id: \"feat\"",
      "  checkout main",
      "  merge feature",
    ].join("\n");
    const result = ext.extract(null, source, "git.mmd");
    expect(result.symbols.find((s) => s.name === "feature")?.decorators).toContain("branch");
    const commits = result.symbols.filter((s) => s.decorators.includes("commit"));
    expect(commits.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts timeline sections + periods + events", () => {
    const ext = new MermaidExtractor();
    const source = [
      "timeline",
      "  title History",
      "  section Early",
      "  2002 : LinkedIn",
      "  2004 : Facebook : Google",
    ].join("\n");
    const result = ext.extract(null, source, "timeline.mmd");
    expect(result.symbols.find((s) => s.decorators.includes("timeline_section"))).toBeDefined();
    expect(result.symbols.filter((s) => s.decorators.includes("timeline_period")).length).toBeGreaterThanOrEqual(2);
  });
});

describe("MermaidExtractor — mindmap", () => {
  it("preserves the parent-child hierarchy via indentation", () => {
    const ext = new MermaidExtractor();
    const source = [
      "mindmap",
      "  root((Center))",
      "    Sub1",
      "      Leaf1",
      "    Sub2",
    ].join("\n");
    const result = ext.extract(null, source, "mm.mmd");

    // `root((Center))` has identifier=`root` and shape-label=`Center`. The
    // identifier — not the label — becomes the canonical name in the graph
    // so arrows like `root --> X` resolve cleanly.
    const root = result.symbols.find((s) => s.name === "root");
    expect(root?.decorators).toContain("circle");
    expect(root?.docstring).toBe("Center");

    const sub1 = result.symbols.find((s) => s.name === "Sub1");
    const leaf1 = result.symbols.find((s) => s.name === "Leaf1");
    expect(sub1?.parent).toBe("root");
    expect(leaf1?.parent).toBe("Sub1");
  });
});

describe("MermaidExtractor — C4", () => {
  it("recognises Person / System / Container / Rel macros", () => {
    const ext = new MermaidExtractor();
    const source = [
      "C4Context",
      '  Person(user, "End user", "Customer")',
      '  System(app, "App", "Web app")',
      '  Rel(user, app, "uses")',
    ].join("\n");
    const result = ext.extract(null, source, "c4.mmd");
    expect(result.symbols.find((s) => s.name === "user")?.decorators).toContain("c4_person");
    expect(result.symbols.find((s) => s.name === "app")?.decorators).toContain("c4_system");
    expect(result.references.find((r) => r.name === "app")).toBeDefined();
  });
});

describe("MermaidExtractor — requirementDiagram", () => {
  it("extracts requirement + element blocks and relations", () => {
    const ext = new MermaidExtractor();
    const source = [
      "requirementDiagram",
      "  requirement test_req {",
      "    id: 1",
      "    text: must work",
      "  }",
      "  element test_entity {",
      "    type: simulation",
      "  }",
      "  test_entity - satisfies -> test_req",
    ].join("\n");
    const result = ext.extract(null, source, "req.mmd");
    expect(result.symbols.find((s) => s.name === "test_req")?.kind).toBe("interface");
    expect(result.symbols.find((s) => s.name === "test_entity")?.kind).toBe("component");
    expect(result.references.length).toBeGreaterThanOrEqual(1);
  });
});

describe("MermaidExtractor — zenuml", () => {
  it("recognises @Actor and @Database annotators + simple arrows", () => {
    const ext = new MermaidExtractor();
    const source = [
      "zenuml",
      "  title Annotators",
      "  @Actor Alice",
      "  @Database Bob",
      "  Alice->Bob: Hi Bob",
      "  Bob->Alice: Hi Alice",
    ].join("\n");
    const result = ext.extract(null, source, "zen.mmd");
    expect(result.symbols.find((s) => s.name === "Alice")?.decorators).toContain("actor");
    expect(result.symbols.find((s) => s.name === "Bob")?.decorators).toContain("database");
    expect(result.references.length).toBeGreaterThanOrEqual(2);
  });
});

describe("MermaidExtractor — unknown / unsupported diagram type", () => {
  it("still produces a valid fileNode tagged 'unknown'", () => {
    const ext = new MermaidExtractor();
    const result = ext.extract(null, "architecture-beta\n  group api(cloud)\n", "arch.mmd");
    expect(result.fileNode.tags).toEqual(["mermaid", "unknown"]);
    expect(result.symbols).toEqual([]);
  });
});

describe("MermaidExtractor.resolveImportPath", () => {
  it("always returns an empty array (Mermaid has no imports)", () => {
    const ext = new MermaidExtractor();
    expect(ext.resolveImportPath("anything", "src/foo.mmd")).toEqual([]);
  });
});
