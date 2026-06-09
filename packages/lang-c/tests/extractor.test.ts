import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SyntaxTree } from "reponova";
import { plugin, CExtractor } from "../src/index.js";
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
  if (!grammar) throw new Error("tree-sitter-c.wasm not present; run `pnpm grammar-fetch`");
});

async function parse(source: string): Promise<SyntaxTree> {
  return grammar!.parse(source) as SyntaxTree;
}

describe("@reponova/lang-c plugin", () => {
  it("exports a valid LanguagePlugin", () => {
    expect(plugin.id).toBe("c");
    expect(plugin.grammarPath).toBeDefined();
    expect(plugin.extractor).toBeInstanceOf(CExtractor);
    expect(plugin.outline).toBeDefined();
  });

  it("declares extensions in its manifest (authoritative source)", () => {
    expect(readManifestExtensions()).toEqual([".c", ".h"]);
  });

  it("extractor has correct metadata", () => {
    const ext = new CExtractor();
    expect(ext.languageId).toBe("c");
    expect(ext.extensions).toEqual([".c", ".h"]);
    expect(ext.wasmFile).toBe("tree-sitter-c.wasm");
  });
});

describe("CExtractor — top-level functions and includes", () => {
  it("extracts a function definition with signature, decorators, and docstring", async () => {
    const source = `
#include <stdio.h>

/** Greet someone. */
static int greet(const char* name) {
  printf("hi %s\\n", name);
  return 0;
}
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "src/greeter.c");

    expect(result.language).toBe("c");
    expect(result.fileNode.kind).toBe("module");
    expect(result.fileNode.label).toBe("greeter.c");

    const greet = result.symbols.find((s) => s.name === "greet");
    expect(greet?.kind).toBe("function");
    expect(greet?.qualifiedName).toBe("src.greeter.greet");
    expect(greet?.decorators).toContain("static");
    expect(greet?.signature).toContain("greet(const char* name)");
    expect(greet?.docstring).toBe("Greet someone.");
  });

  it("captures #include as wildcard imports preserving system vs user form", async () => {
    const source = `
#include <stdio.h>
#include "local.h"
#include "../shared/util.h"
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "src/main.c");

    expect(result.imports.map((i) => i.module)).toEqual([
      "<stdio.h>",
      "local.h",
      "../shared/util.h",
    ]);
    for (const imp of result.imports) {
      expect(imp.isWildcard).toBe(true);
      expect(imp.names).toEqual([]);
    }
  });

  it("captures call expressions inside a function body as `calls` references", async () => {
    const source = `
void foo(int x);
void bar(int y);

int main(void) {
  foo(1);
  bar(2);
  foo(3);
  return 0;
}
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "main.c");

    const callsFromMain = result.references
      .filter((r) => r.fromSymbol === "main.main" && r.kind === "calls")
      .map((r) => r.name)
      .sort();
    expect(callsFromMain).toEqual(["bar", "foo"]);
  });

  it("collapses duplicate call edges per caller", async () => {
    const source = `
int counter(void);
int sum(void) {
  return counter() + counter() + counter();
}
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "u.c");
    const edges = result.references.filter(
      (r) => r.fromSymbol === "u.sum" && r.name === "counter",
    );
    expect(edges.length).toBe(1);
  });

  it("surfaces field-expression callees with dotted form", async () => {
    const source = `
struct V { int (*f)(int); };
int caller(struct V* v) { return v->f(1) + v->f(2); }
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "u.c");
    const calls = result.references.filter((r) => r.fromSymbol === "u.caller");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.name === "v.f")).toBe(true);
  });
});

describe("CExtractor — structs, unions, enums, typedefs", () => {
  it("extracts a top-level struct with its fields", async () => {
    const source = `
struct Point {
  int x;
  int y;
};
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "geom.c");

    const point = result.symbols.find((s) => s.name === "Point");
    expect(point?.kind).toBe("class");
    expect(point?.qualifiedName).toBe("geom.Point");
    expect(point?.decorators).toContain("struct");

    const fields = result.symbols.filter((s) => s.parent === "geom.Point");
    expect(fields.map((f) => f.name).sort()).toEqual(["x", "y"]);
    for (const f of fields) {
      expect(f.kind).toBe("variable");
      expect(f.decorators).toContain("field");
    }
  });

  it("emits a function-pointer field as `method` kind with function_pointer decorator", async () => {
    const source = `
struct Handlers {
  int (*on_open)(int fd);
  void (*on_close)(int fd);
};
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "h.c");
    const onOpen = result.symbols.find((s) => s.name === "on_open");
    expect(onOpen?.kind).toBe("method");
    expect(onOpen?.decorators).toContain("function_pointer");
    expect(onOpen?.parent).toBe("h.Handlers");
  });

  it("extracts a top-level union and tags it accordingly", async () => {
    const source = `
union Value {
  int i;
  float f;
};
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "v.c");
    const u = result.symbols.find((s) => s.name === "Value");
    expect(u?.kind).toBe("class");
    expect(u?.decorators).toContain("union");
  });

  it("extracts an enum with its enumerators as constants", async () => {
    const source = `
enum Status { OK = 0, ERR = -1, PENDING };
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "s.c");

    const status = result.symbols.find((s) => s.name === "Status");
    expect(status?.kind).toBe("enum");

    const values = result.symbols.filter((s) => s.parent === "s.Status");
    expect(values.map((v) => v.name).sort()).toEqual(["ERR", "OK", "PENDING"]);
    for (const v of values) {
      expect(v.kind).toBe("constant");
      expect(v.decorators).toContain("enum_constant");
    }
  });

  it("extracts a typedef alias as a `type` symbol with `typedef` decorator", async () => {
    const source = `
typedef int counter_t;
typedef int (*callback_t)(int);
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "t.c");

    const counter = result.symbols.find((s) => s.name === "counter_t");
    expect(counter?.kind).toBe("type");
    expect(counter?.decorators).toContain("typedef");

    const callback = result.symbols.find((s) => s.name === "callback_t");
    expect(callback?.kind).toBe("type");
    expect(callback?.decorators).toContain("typedef");
  });

  it("extracts both the alias AND the inline anonymous struct for `typedef struct { ... } Foo`", async () => {
    const source = `
typedef struct {
  int x;
  int y;
} Point;
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "p.c");

    const recordSymbols = result.symbols.filter((s) => s.kind === "class");
    expect(recordSymbols.length).toBe(1);
    expect(recordSymbols[0]!.name).toBe("Point");

    const alias = result.symbols.find((s) => s.name === "Point" && s.kind === "type");
    expect(alias?.decorators).toContain("typedef");
  });

  it("extracts both the alias AND the named struct for `typedef struct X { ... } Y`", async () => {
    const source = `
typedef struct Point {
  int x;
  int y;
} Pt;
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "p.c");

    const point = result.symbols.find((s) => s.name === "Point" && s.kind === "class");
    expect(point).toBeDefined();
    const pt = result.symbols.find((s) => s.name === "Pt" && s.kind === "type");
    expect(pt).toBeDefined();
  });

  it("skips forward declarations of structs (no body, no field list)", async () => {
    const source = `
struct Foo;
struct Bar { int x; };
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "f.c");
    const foo = result.symbols.find((s) => s.name === "Foo");
    const bar = result.symbols.find((s) => s.name === "Bar");
    expect(foo).toBeUndefined();
    expect(bar).toBeDefined();
  });
});

describe("CExtractor — macros and globals", () => {
  it("extracts an object-like macro as a constant tagged `macro`", async () => {
    const source = `
#define MAX 16
#define GREETING "hello"
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "c.c");

    const max = result.symbols.find((s) => s.name === "MAX");
    expect(max?.kind).toBe("constant");
    expect(max?.decorators).toContain("macro");
    expect(max?.signature).toContain("MAX = 16");

    const greet = result.symbols.find((s) => s.name === "GREETING");
    expect(greet?.kind).toBe("constant");
  });

  it("extracts a function-like macro as a function tagged `macro` + `function_like`", async () => {
    const source = `
#define MAX(a, b) ((a) > (b) ? (a) : (b))
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "c.c");
    const max = result.symbols.find((s) => s.name === "MAX");
    expect(max?.kind).toBe("function");
    expect(max?.decorators).toEqual(expect.arrayContaining(["macro", "function_like"]));
  });

  it("extracts global variables and tags `const` ones as constants", async () => {
    const source = `
int counter;
static int local_counter = 0;
const char* greeting = "hi";
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "g.c");

    const counter = result.symbols.find((s) => s.name === "counter");
    expect(counter?.kind).toBe("variable");

    const local = result.symbols.find((s) => s.name === "local_counter");
    expect(local?.kind).toBe("variable");
    expect(local?.decorators).toContain("static");

    const greeting = result.symbols.find((s) => s.name === "greeting");
    expect(greeting?.kind).toBe("constant");
    expect(greeting?.decorators).toContain("const");
  });

  it("emits an external function declaration as a function with `extern`/`declaration` decorator", async () => {
    const source = `
extern void external_decl(void);
int local_def(int x) { return x; }
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "p.c");

    const ext = result.symbols.find((s) => s.name === "external_decl");
    expect(ext?.kind).toBe("function");
    expect(ext?.decorators).toEqual(expect.arrayContaining(["extern"]));

    const def = result.symbols.find((s) => s.name === "local_def");
    expect(def?.kind).toBe("function");
    expect(def?.decorators).not.toContain("declaration");
  });
});

describe("CExtractor — preprocessor containers", () => {
  it("walks into `#ifndef HEADER_H` guards and surfaces inner declarations", async () => {
    const source = `
#ifndef HEADER_H
#define HEADER_H

void api(void);
#define API_LIMIT 100

#endif
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "header.h");

    const api = result.symbols.find((s) => s.name === "api");
    expect(api?.kind).toBe("function");
    const limit = result.symbols.find((s) => s.name === "API_LIMIT");
    expect(limit?.decorators).toContain("macro");
  });

  it("walks into `extern \"C\"` linkage specifications", async () => {
    const source = `
#ifdef __cplusplus
extern "C" {
#endif

void public_fn(int x);

#ifdef __cplusplus
}
#endif
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "header.h");

    expect(result.symbols.find((s) => s.name === "public_fn")).toBeDefined();
  });

  it("walks into `#if`/`#elif`/`#else` branches uniformly", async () => {
    const source = `
#if defined(__linux__)
void linux_only(void);
#elif defined(_WIN32)
void win_only(void);
#else
void other_platform(void);
#endif
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "platform.h");

    const names = result.symbols.map((s) => s.name).sort();
    expect(names).toEqual(["linux_only", "other_platform", "win_only"]);
  });
});

describe("CExtractor — exports", () => {
  it("includes non-static function and global var/const DEFINITIONS only", async () => {
    const source = `
int pub_a(void) { return 1; }
static int priv_b(void) { return 2; }
extern void declared_only(void);
int pub_c;
static int priv_d;
const int PUB_K = 42;
#define PUB_M 42
struct PubS { int x; };
typedef int pub_t;
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "m.c");

    // Exports = linker-visible definitions only:
    // - pub_a (function definition)
    // - pub_c (global variable definition)
    // - PUB_K (global const with external linkage)
    // Excluded:
    // - priv_b, priv_d (static),
    // - declared_only (declaration / extern),
    // - PUB_M (macro — preprocessor only),
    // - PubS (struct — type-level, no link symbol),
    // - pub_t (typedef — type-level, no link symbol).
    expect(result.exports.sort()).toEqual(["PUB_K", "pub_a", "pub_c"]);
  });
});

describe("CExtractor — docstring variants", () => {
  it("accepts Doxygen `/*! …*\\/` blocks as docstrings", async () => {
    const source = `
/*! summary line. */
int foo(void) { return 0; }
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "d.c");
    const foo = result.symbols.find((s) => s.name === "foo");
    expect(foo?.docstring).toBe("summary line.");
  });

  it("accepts contiguous `///` line-comment groups as docstrings", async () => {
    const source = `
/// first line.
/// second line.
int bar(void) { return 1; }
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "d.c");
    const bar = result.symbols.find((s) => s.name === "bar");
    expect(bar?.docstring).toBeDefined();
    expect(bar?.docstring).toContain("first line");
  });

  it("accepts a plain `/* … */` block at file head as file docstring", async () => {
    const source = `
/*
 * Plain header — first line of summary.
 * trailing detail.
 */
int x;
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "d.c");
    expect(result.fileNode.docstring).toBe("Plain header — first line of summary.");
  });

  it("accepts a `///` line at file head as file docstring", async () => {
    const source = `/// File-level summary.
int x;
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "d.c");
    expect(result.fileNode.docstring).toBe("File-level summary.");
  });

  it("accepts a `//` line at file head as file docstring", async () => {
    const source = `// File-level summary.
int x;
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "d.c");
    expect(result.fileNode.docstring).toBe("File-level summary.");
  });

  it("ignores plain `/* */` comments preceding a declaration (Doxy-only for symbol docs)", async () => {
    const source = `
/* regular comment, not Doxy */
int z(void) { return 0; }
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "d.c");
    const z = result.symbols.find((s) => s.name === "z");
    expect(z?.docstring).toBeUndefined();
  });
});

describe("CExtractor — anonymous and inline records", () => {
  it("extracts a typedef'd anonymous enum with the alias name", async () => {
    const source = `
typedef enum { A, B, C } abc_t;
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "e.c");
    const abc = result.symbols.find((s) => s.name === "abc_t" && s.kind === "enum");
    expect(abc).toBeDefined();
    const aliasType = result.symbols.find((s) => s.name === "abc_t" && s.kind === "type");
    expect(aliasType).toBeDefined();
    const constants = result.symbols.filter((s) => s.parent === "e.abc_t");
    expect(constants.map((c) => c.name).sort()).toEqual(["A", "B", "C"]);
  });

  it("skips anonymous structs without a typedef", async () => {
    const source = `
struct { int a; int b; } anon_var;
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "a.c");
    const types = result.symbols.filter((s) => s.kind === "class");
    expect(types.length).toBe(0);
  });

  it("handles inline struct in a declaration (`struct X { ... } x;`)", async () => {
    const source = `
struct Pair { int a; int b; } pair_var;
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "i.c");
    const pair = result.symbols.find((s) => s.name === "Pair" && s.kind === "class");
    expect(pair).toBeDefined();
    const pairVar = result.symbols.find((s) => s.name === "pair_var");
    expect(pairVar?.kind).toBe("variable");
  });

  it("handles inline enum in a declaration (`enum E { ... } e;`)", async () => {
    const source = `
enum E { ONE, TWO } e_var;
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "i.c");
    const e = result.symbols.find((s) => s.name === "E" && s.kind === "enum");
    expect(e).toBeDefined();
  });

  it("extracts pointer-returning functions and array globals", async () => {
    const source = `
int* make_array(void) { return 0; }
int table[10];
`;
    const tree = await parse(source);
    const result = new CExtractor().extract(tree, source, "p.c");
    const fn = result.symbols.find((s) => s.name === "make_array");
    expect(fn?.kind).toBe("function");
    const table = result.symbols.find((s) => s.name === "table");
    expect(table?.kind).toBe("variable");
  });

  it("declarations with no resolvable name produce no symbol (no crash)", async () => {
    // Function-pointer DECLARATION (not definition or typedef) — the
    // declarator chain wraps a pointer_declarator with a
    // parenthesized_declarator. We do not surface it (it lacks a
    // recognisable function-definition declarator).
    const source = `
int (*get_fn(void))(int);
`;
    const tree = await parse(source);
    expect(() => new CExtractor().extract(tree, source, "p.c")).not.toThrow();
  });
});

describe("CExtractor.resolveImportPath", () => {
  it("returns no candidates for system includes (angle brackets)", () => {
    const ext = new CExtractor();
    expect(ext.resolveImportPath("<stdio.h>", "src/main.c")).toEqual([]);
    expect(ext.resolveImportPath("<sys/types.h>", "src/main.c")).toEqual([]);
  });

  it("resolves a quoted include relative to the including file's directory", () => {
    const ext = new CExtractor();
    expect(ext.resolveImportPath("util.h", "src/main.c")).toEqual([
      "src/util.h",
      "util.h",
    ]);
  });

  it("walks parent directories for `../shared/util.h` style includes", () => {
    const ext = new CExtractor();
    expect(ext.resolveImportPath("../shared/util.h", "src/main.c")).toEqual([
      "shared/util.h",
      "../shared/util.h",
    ]);
  });

  it("dedupes when the relative and repo-root paths coincide", () => {
    const ext = new CExtractor();
    // File at repo root → dirname is empty → relative-to-file === repo-root path.
    expect(ext.resolveImportPath("util.h", "main.c")).toEqual(["util.h"]);
  });

  it("normalises Windows-style backslashes in the include path", () => {
    const ext = new CExtractor();
    expect(ext.resolveImportPath("sub\\util.h", "src/main.c")).toEqual([
      "src/sub/util.h",
      "sub/util.h",
    ]);
  });

  it("returns [] for empty input", () => {
    const ext = new CExtractor();
    expect(ext.resolveImportPath("", "src/main.c")).toEqual([]);
  });
});
