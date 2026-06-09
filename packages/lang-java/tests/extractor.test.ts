import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SyntaxTree } from "reponova";
import { plugin, JavaExtractor } from "../src/index.js";
import { loadGrammar } from "@reponova/lang-test-utils";

function readManifestExtensions(): string[] {
  const pkgJsonPath = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "package.json",
  );
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  return pkg.reponova?.extensions ?? [];
}

let grammar: Awaited<ReturnType<typeof loadGrammar>>;

beforeAll(async () => {
  grammar = await loadGrammar(plugin.grammarPath!);
  if (!grammar) throw new Error("tree-sitter-java.wasm not present; run `pnpm grammar-fetch`");
});

async function parse(source: string): Promise<SyntaxTree> {
  return grammar!.parse(source) as SyntaxTree;
}

describe("@reponova/lang-java plugin", () => {
  it("exports a valid LanguagePlugin", () => {
    expect(plugin.id).toBe("java");
    expect(plugin.grammarPath).toBeDefined();
    expect(plugin.extractor).toBeInstanceOf(JavaExtractor);
    expect(plugin.outline).toBeDefined();
  });

  it("declares extensions in its manifest (authoritative source)", () => {
    expect(readManifestExtensions()).toEqual([".java"]);
  });

  it("extractor has correct metadata", () => {
    const ext = new JavaExtractor();
    expect(ext.languageId).toBe("java");
    expect(ext.extensions).toEqual([".java"]);
    expect(ext.wasmFile).toBe("tree-sitter-java.wasm");
  });
});

describe("JavaExtractor — classes, interfaces, enums, records", () => {
  it("extracts a top-level public class with fields, constructor, and methods", async () => {
    const source = `
package com.example;

import java.util.Objects;

/** Greet someone. */
public final class Greeter {
  public static final String PREFIX = "Hi";
  private final String name;

  public Greeter(String name) {
    this.name = Objects.requireNonNull(name);
  }

  public String greet() {
    return PREFIX + ", " + name;
  }
}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "src/main/java/com/example/Greeter.java");

    expect(result.language).toBe("java");
    expect(result.fileNode.kind).toBe("module");
    expect(result.fileNode.label).toBe("Greeter.java");

    const greeter = result.symbols.find((s) => s.name === "Greeter");
    expect(greeter?.kind).toBe("class");
    expect(greeter?.qualifiedName).toBe("com.example.Greeter");
    expect(greeter?.decorators).toContain("public");
    expect(greeter?.decorators).toContain("final");
    expect(greeter?.docstring).toBe("Greet someone.");

    const prefix = result.symbols.find((s) => s.name === "PREFIX");
    expect(prefix?.kind).toBe("constant");
    expect(prefix?.qualifiedName).toBe("com.example.Greeter.PREFIX");
    expect(prefix?.decorators).toContain("public");
    expect(prefix?.decorators).toContain("static");
    expect(prefix?.decorators).toContain("final");

    const name = result.symbols.find((s) => s.name === "name");
    expect(name?.kind).toBe("variable");
    expect(name?.decorators).toContain("private");
    expect(name?.decorators).toContain("final");

    const ctor = result.symbols.find((s) => s.qualifiedName === "com.example.Greeter.Greeter" && s.kind === "method");
    expect(ctor?.decorators).toContain("constructor");
    expect(ctor?.decorators).toContain("public");

    const greet = result.symbols.find((s) => s.name === "greet");
    expect(greet?.kind).toBe("method");
    expect(greet?.qualifiedName).toBe("com.example.Greeter.greet");
    expect(greet?.signature).toBe("greet(): String");
  });

  it("captures extends + implements as bases AND extends edges", async () => {
    const source = `
package a.b;

import a.c.Base;

public class Service extends Base<String> implements Runnable, AutoCloseable {
  @Override public void run() {}
  @Override public void close() {}
}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "src/Service.java");

    const svc = result.symbols.find((s) => s.name === "Service");
    expect(svc?.bases).toEqual(["Base", "Runnable", "AutoCloseable"]);

    const extendsEdges = result.references.filter((r) => r.kind === "extends");
    const targets = extendsEdges.map((r) => r.name).sort();
    expect(targets).toEqual(["AutoCloseable", "Base", "Runnable"]);
    for (const edge of extendsEdges) {
      expect(edge.fromSymbol).toBe("a.b.Service");
    }
  });

  it("captures interface extends-list and default methods", async () => {
    const source = `
package x;

public interface Repo<T> extends Iterable<T>, AutoCloseable {
  T findById(long id);
  default boolean exists(long id) { return findById(id) != null; }
}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "Repo.java");

    const repo = result.symbols.find((s) => s.name === "Repo");
    expect(repo?.kind).toBe("interface");
    expect(repo?.bases).toEqual(["Iterable", "AutoCloseable"]);

    const exists = result.symbols.find((s) => s.name === "exists");
    expect(exists?.kind).toBe("method");
    expect(exists?.decorators).toContain("default");
  });

  it("extracts enum constants and enum methods", async () => {
    const source = `
package x;

public enum Status {
  ACTIVE, INACTIVE, PAUSED;
  public boolean isActive() { return this == ACTIVE; }
}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "Status.java");

    const status = result.symbols.find((s) => s.name === "Status");
    expect(status?.kind).toBe("enum");

    const consts = result.symbols.filter((s) => s.parent === "x.Status" && s.kind === "constant");
    expect(consts.map((s) => s.name).sort()).toEqual(["ACTIVE", "INACTIVE", "PAUSED"]);
    for (const c of consts) {
      expect(c.decorators).toContain("enum_constant");
    }

    const isActive = result.symbols.find((s) => s.name === "isActive");
    expect(isActive?.kind).toBe("method");
    expect(isActive?.parent).toBe("x.Status");
  });

  it("extracts record components and methods, tagging the record decorator", async () => {
    const source = `
package x;

public record Point(int x, int y) implements Comparable<Point> {
  public int sum() { return x + y; }
  @Override public int compareTo(Point o) { return 0; }
}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "Point.java");

    const point = result.symbols.find((s) => s.name === "Point" && s.kind === "class");
    expect(point?.decorators).toContain("record");
    expect(point?.bases).toEqual(["Comparable"]);

    const x = result.symbols.find((s) => s.name === "x" && s.parent === "x.Point");
    expect(x?.kind).toBe("variable");
    expect(x?.decorators).toContain("record_component");

    const sum = result.symbols.find((s) => s.name === "sum");
    expect(sum?.kind).toBe("method");
  });

  it("extracts nested types and qualifies them through the parent chain", async () => {
    const source = `
package x;

public class Outer {
  public static class Mid {
    public class Inner {
      public void deep() {}
    }
  }
}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "Outer.java");

    const outer = result.symbols.find((s) => s.name === "Outer");
    const mid = result.symbols.find((s) => s.name === "Mid");
    const inner = result.symbols.find((s) => s.name === "Inner");
    const deep = result.symbols.find((s) => s.name === "deep");

    expect(outer?.qualifiedName).toBe("x.Outer");
    expect(mid?.qualifiedName).toBe("x.Outer.Mid");
    expect(mid?.parent).toBe("x.Outer");
    expect(inner?.qualifiedName).toBe("x.Outer.Mid.Inner");
    expect(inner?.parent).toBe("x.Outer.Mid");
    expect(deep?.qualifiedName).toBe("x.Outer.Mid.Inner.deep");
    expect(deep?.parent).toBe("x.Outer.Mid.Inner");
  });

  it("extracts annotation interfaces and surfaces elements as methods", async () => {
    const source = `
package x;

public @interface Marker {
  String value() default "";
  int priority() default 0;
}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "Marker.java");

    const marker = result.symbols.find((s) => s.name === "Marker");
    expect(marker?.kind).toBe("interface");
    expect(marker?.decorators).toContain("annotation");

    const value = result.symbols.find((s) => s.name === "value");
    expect(value?.kind).toBe("method");
    expect(value?.decorators).toContain("annotation_element");
  });
});

describe("JavaExtractor — annotations and modifiers", () => {
  it("captures both annotation-style and keyword modifiers", async () => {
    const source = `
package x;

@SuppressWarnings("unchecked")
public abstract class C {
  @Override
  @Deprecated
  protected synchronized final void foo() {}
}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "C.java");

    const c = result.symbols.find((s) => s.name === "C");
    expect(c?.decorators).toContain("SuppressWarnings");
    expect(c?.decorators).toContain("public");
    expect(c?.decorators).toContain("abstract");

    const foo = result.symbols.find((s) => s.name === "foo");
    expect(foo?.decorators).toContain("Override");
    expect(foo?.decorators).toContain("Deprecated");
    expect(foo?.decorators).toContain("protected");
    expect(foo?.decorators).toContain("synchronized");
    expect(foo?.decorators).toContain("final");
  });

  it("captures fully-qualified annotation names (scoped_identifier)", async () => {
    const source = `
package x;

@java.lang.SuppressWarnings("x")
public class C {}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "C.java");

    const c = result.symbols.find((s) => s.name === "C");
    expect(c?.decorators).toContain("java.lang.SuppressWarnings");
  });
});

describe("JavaExtractor — imports", () => {
  it("classifies plain, static, and wildcard imports", async () => {
    const source = `
package x;

import java.util.Map;
import java.util.HashMap;
import static java.util.Collections.emptyList;
import static java.util.Collections.*;
import com.example.util.*;

public class C {}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "C.java");

    const byModule = (m: string) => result.imports.find((i) => i.module === m);

    expect(byModule("java.util")?.names).toEqual(["Map"]);
    expect(byModule("java.util")?.isWildcard).toBe(false);

    const sec = result.imports.find((i) => i.module === "java.util" && i.names[0] === "HashMap");
    expect(sec).toBeDefined();

    const statc = result.imports.find((i) => i.module === "java.util.Collections" && i.names[0] === "emptyList");
    expect(statc).toBeDefined();

    const statcWild = result.imports.find((i) => i.module === "java.util.Collections" && i.isWildcard);
    expect(statcWild).toBeDefined();

    const pkgWild = result.imports.find((i) => i.module === "com.example.util" && i.isWildcard);
    expect(pkgWild).toBeDefined();
  });
});

describe("JavaExtractor — method calls", () => {
  it("captures method invocations and object-creation as call references", async () => {
    const source = `
package x;

import java.util.HashMap;
import java.util.Map;

public class C {
  public void run() {
    Map<String, String> m = new HashMap<>();
    m.put("k", "v");
    helper();
    Util.process(m);
    System.out.println("hi");
  }
  private void helper() {}
}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "C.java");

    const callsFromRun = result.references
      .filter((r) => r.kind === "calls" && r.fromSymbol === "x.C.run")
      .map((r) => r.name)
      .sort();
    expect(callsFromRun).toContain("HashMap");
    expect(callsFromRun).toContain("m.put");
    expect(callsFromRun).toContain("helper");
    expect(callsFromRun).toContain("Util.process");
    expect(callsFromRun).toContain("System.out.println");
  });

  it("deduplicates repeated calls within the same method", async () => {
    const source = `
package x;

public class C {
  public void run() {
    helper();
    helper();
    helper();
  }
  private void helper() {}
}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "C.java");

    const helperCalls = result.references.filter((r) => r.name === "helper" && r.fromSymbol === "x.C.run");
    expect(helperCalls).toHaveLength(1);
  });
});

describe("JavaExtractor — exports & docstrings", () => {
  it("exports only top-level public types of the file's package", async () => {
    const source = `
package x;

public class Pub {}
class Pkg {}        // package-private
public class Pub2 {
  public static class Nested {}  // nested — never exported
}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "Pub.java");

    expect(result.exports).toEqual(expect.arrayContaining(["Pub", "Pub2"]));
    expect(result.exports).not.toContain("Pkg");
    expect(result.exports).not.toContain("Nested");
  });

  it("strips Javadoc decoration and keeps the first non-tag line", async () => {
    const source = `
package x;

/**
 * Hello world.
 * <p>More details follow.</p>
 *
 * @param x ignored
 */
public class C {
  /**
   * Compute things.
   * @return zero
   */
  public int compute() { return 0; }
}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "C.java");

    const c = result.symbols.find((s) => s.name === "C");
    expect(c?.docstring).toBe("Hello world.");

    const compute = result.symbols.find((s) => s.name === "compute");
    expect(compute?.docstring).toBe("Compute things.");
  });

  it("captures a file-level header Javadoc that precedes the first type", async () => {
    const source = `
/**
 * Copyright 2026 ACME.
 */
package x;

public class C {}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "C.java");
    expect(result.fileNode.docstring).toBe("Copyright 2026 ACME.");
  });

  it("handles a file without a package declaration", async () => {
    const source = `
public class Loose {
  public void run() {}
}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "Loose.java");

    const loose = result.symbols.find((s) => s.name === "Loose");
    expect(loose?.qualifiedName).toBe("Loose");
    const run = result.symbols.find((s) => s.name === "run");
    expect(run?.qualifiedName).toBe("Loose.run");
  });
});

describe("JavaExtractor — field declarations with multiple variables", () => {
  it("emits one symbol per variable_declarator", async () => {
    const source = `
package x;

public class C {
  private int x, y, z;
  public static final String A = "a", B = "b";
}
`;
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "C.java");

    const fields = result.symbols.filter((s) => s.parent === "x.C" && s.kind === "variable");
    expect(fields.map((s) => s.name).sort()).toEqual(["x", "y", "z"]);

    const consts = result.symbols.filter((s) => s.parent === "x.C" && s.kind === "constant");
    expect(consts.map((s) => s.name).sort()).toEqual(["A", "B"]);
  });
});
