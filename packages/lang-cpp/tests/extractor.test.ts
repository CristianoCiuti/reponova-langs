import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SyntaxTree } from "reponova";
import { plugin, CppExtractor } from "../src/index.js";
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
  if (!grammar) throw new Error("tree-sitter-cpp.wasm not present; run `pnpm grammar-fetch`");
});

async function parse(source: string): Promise<SyntaxTree> {
  return grammar!.parse(source) as SyntaxTree;
}

describe("@reponova/lang-cpp plugin", () => {
  it("exports a valid LanguagePlugin", () => {
    expect(plugin.id).toBe("cpp");
    expect(plugin.grammarPath).toBeDefined();
    expect(plugin.extractor).toBeInstanceOf(CppExtractor);
    expect(plugin.outline).toBeDefined();
  });

  it("manifest declares the canonical C++ extension set", () => {
    expect(readManifestExtensions()).toEqual([
      ".cpp",
      ".cc",
      ".cxx",
      ".c++",
      ".hpp",
      ".hh",
      ".hxx",
      ".h++",
    ]);
  });

  it("extractor has correct metadata", () => {
    const ext = new CppExtractor();
    expect(ext.languageId).toBe("cpp");
    expect(ext.extensions).toEqual([
      ".cpp",
      ".cc",
      ".cxx",
      ".c++",
      ".hpp",
      ".hh",
      ".hxx",
      ".h++",
    ]);
    expect(ext.wasmFile).toBe("tree-sitter-cpp.wasm");
  });
});

describe("CppExtractor — namespaces", () => {
  it("emits a `module` symbol for a named namespace and qualifies its contents", async () => {
    const source = `
namespace foo {
  int answer = 42;
  void hello();
}
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "ns.cpp");
    const ns = result.symbols.find((s) => s.name === "foo" && s.kind === "module");
    expect(ns).toBeDefined();
    expect(ns?.qualifiedName).toBe("ns.foo");
    expect(ns?.decorators).toContain("namespace");

    const answer = result.symbols.find((s) => s.name === "answer");
    expect(answer?.qualifiedName).toBe("ns.foo.answer");
    const hello = result.symbols.find((s) => s.name === "hello");
    expect(hello?.qualifiedName).toBe("ns.foo.hello");
  });

  it("recurses through nested namespaces, building dotted scope", async () => {
    const source = `
namespace a {
  namespace b {
    namespace c {
      int x = 1;
    }
  }
}
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "nested.cpp");
    const x = result.symbols.find((s) => s.name === "x");
    expect(x?.qualifiedName).toBe("nested.a.b.c.x");
    expect(result.symbols.filter((s) => s.kind === "module").map((s) => s.name).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("does not emit a symbol for an anonymous namespace but still walks its body", async () => {
    const source = `
namespace {
  int private_id = 0;
}
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "anon.cpp");
    expect(result.symbols.find((s) => s.kind === "module")).toBeUndefined();
    const v = result.symbols.find((s) => s.name === "private_id");
    expect(v?.qualifiedName).toBe("anon.private_id");
  });
});

describe("CppExtractor — classes & structs", () => {
  it("emits a class symbol with `class` decorator and the canonical signature", async () => {
    const source = `class Widget { public: int w_; };`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "w.cpp");
    const cls = result.symbols.find((s) => s.kind === "class");
    expect(cls?.name).toBe("Widget");
    expect(cls?.qualifiedName).toBe("w.Widget");
    expect(cls?.decorators).toContain("class");
    expect(cls?.signature).toBe("class Widget");
  });

  it("emits structs with the `struct` decorator and default-public access", async () => {
    const source = `struct Point { int x; int y; };`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "p.cpp");
    const cls = result.symbols.find((s) => s.name === "Point");
    expect(cls?.decorators).toContain("struct");
    const x = result.symbols.find((s) => s.name === "x");
    expect(x?.decorators).toContain("public");
  });

  it("tracks access specifier transitions and tags each member accordingly", async () => {
    const source = `
class C {
 public:
  int pub_a;
 protected:
  int prot_a;
 private:
  int priv_a;
 public:
  int pub_b;
};
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "c.cpp");
    const lookup = (n: string) => result.symbols.find((s) => s.name === n);
    expect(lookup("pub_a")?.decorators).toContain("public");
    expect(lookup("prot_a")?.decorators).toContain("protected");
    expect(lookup("priv_a")?.decorators).toContain("private");
    expect(lookup("pub_b")?.decorators).toContain("public");
  });

  it("surfaces bases as `extends` references", async () => {
    const source = `
class Base {};
class Mixin {};
class Derived : public Base, protected Mixin {};
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "d.cpp");
    const extends_ = result.references.filter((r) => r.kind === "extends");
    expect(extends_.map((r) => r.name).sort()).toEqual(["Base", "Mixin"]);
    expect(extends_.every((r) => r.fromSymbol === "d.Derived")).toBe(true);
  });

  it("tags constructors and destructors with `ctor` / `dtor` decorators", async () => {
    const source = `
class Foo {
 public:
  Foo();
  ~Foo();
  explicit Foo(int x);
};
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "f.cpp");
    const ctors = result.symbols.filter((s) => s.name === "Foo" && s.kind === "method");
    expect(ctors.length).toBe(2);
    expect(ctors.every((s) => s.decorators.includes("ctor"))).toBe(true);
    const dtor = result.symbols.find((s) => s.name === "~Foo");
    expect(dtor?.decorators).toContain("dtor");
  });

  it("emits operator overloads with the `operator` decorator", async () => {
    const source = `
class Mat {
 public:
  Mat& operator=(const Mat& other);
};
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "m.cpp");
    const op = result.symbols.find((s) => s.name === "operator=");
    expect(op).toBeDefined();
    expect(op?.decorators).toContain("operator");
    expect(op?.parent).toBe("m.Mat");
  });

  it("nests methods and fields under the class qualified name", async () => {
    const source = `
class Foo {
 public:
  int x_;
  void run();
};
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "f.cpp");
    const x = result.symbols.find((s) => s.name === "x_");
    expect(x?.parent).toBe("f.Foo");
    expect(x?.qualifiedName).toBe("f.Foo.x_");
    const run = result.symbols.find((s) => s.name === "run");
    expect(run?.kind).toBe("method");
    expect(run?.qualifiedName).toBe("f.Foo.run");
  });

  it("emits inline method definitions and captures their callees", async () => {
    const source = `
int helper();
class K {
 public:
  int run() { return helper() + 1; }
};
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "k.cpp");
    const run = result.symbols.find((s) => s.name === "run");
    expect(run?.kind).toBe("method");
    expect(run?.qualifiedName).toBe("k.K.run");
    const callRef = result.references.find(
      (r) => r.kind === "calls" && r.fromSymbol === "k.K.run",
    );
    expect(callRef?.name).toBe("helper");
  });
});

describe("CppExtractor — templates", () => {
  it("emits a templated class with the `template` decorator and signature prefix", async () => {
    const source = `
template <typename T>
class Container {
 public:
  T value_;
};
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "ctr.cpp");
    const cls = result.symbols.find((s) => s.name === "Container");
    expect(cls?.kind).toBe("class");
    expect(cls?.decorators).toContain("template");
    expect(cls?.signature).toMatch(/^template<typename T> class Container$/);
    const v = result.symbols.find((s) => s.name === "value_");
    expect(v?.parent).toBe("ctr.Container");
  });

  it("emits a templated free function as a function with `template` decorator", async () => {
    const source = `
template <typename T>
T identity(T x) { return x; }
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "id.cpp");
    const fn = result.symbols.find((s) => s.name === "identity");
    expect(fn?.kind).toBe("function");
    expect(fn?.decorators).toContain("template");
    expect(fn?.signature).toMatch(/^template/);
  });
});

describe("CppExtractor — using / aliases", () => {
  it("`using std::cout;` becomes a named import", async () => {
    const source = `using std::cout;`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "u.cpp");
    expect(result.imports).toEqual([
      { module: "std", names: ["cout"], isWildcard: false, line: 1 },
    ]);
  });

  it("`using namespace std;` becomes a wildcard import", async () => {
    const source = `using namespace std;`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "u.cpp");
    expect(result.imports).toEqual([
      { module: "std", names: [], isWildcard: true, line: 1 },
    ]);
  });

  it("`using X = Y;` emits a type symbol tagged `alias`", async () => {
    const source = `using Counter = int;`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "u.cpp");
    const t = result.symbols.find((s) => s.name === "Counter");
    expect(t?.kind).toBe("type");
    expect(t?.decorators).toContain("alias");
    expect(t?.signature).toMatch(/Counter\s*=\s*int/);
  });
});

describe("CppExtractor — out-of-class definitions", () => {
  it("`void Foo::bar() { … }` qualifies the method under its class", async () => {
    const source = `
void Foo::bar() {
  int x = 0;
  (void)x;
}
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "out.cpp");
    const bar = result.symbols.find((s) => s.name === "bar");
    expect(bar?.kind).toBe("method");
    expect(bar?.qualifiedName).toBe("out.Foo.bar");
    expect(bar?.parent).toBe("out.Foo");
    expect(bar?.decorators).toContain("out_of_class");
  });

  it("handles multi-level qualifiers (`a::b::method`) by extending scope", async () => {
    const source = `
void ns::Cls::method() {}
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "x.cpp");
    const m = result.symbols.find((s) => s.name === "method");
    expect(m?.qualifiedName).toBe("x.ns.Cls.method");
    expect(m?.parent).toBe("x.ns.Cls");
  });
});

describe("CppExtractor — exports", () => {
  it("includes top-level free functions, variables, namespaces, and classes", async () => {
    const source = `
int free_fn() { return 0; }
int top_var = 1;
namespace ns { int inner = 2; }
class Cls {};
static int hidden = 5;
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "ex.cpp");
    expect(result.exports).toEqual(
      expect.arrayContaining(["free_fn", "top_var", "ns", "Cls"]),
    );
    expect(result.exports).not.toContain("hidden"); // static
    expect(result.exports).not.toContain("inner");  // nested inside ns
  });
});

describe("CppExtractor — class body edge cases", () => {
  it("ignores friend declarations without emitting symbols or crashing", async () => {
    const source = `
class Box {
  friend class Inspector;
  friend bool operator==(const Box&, const Box&);
 public:
  int v_;
};
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "b.cpp");
    const cls = result.symbols.find((s) => s.name === "Box");
    expect(cls).toBeDefined();
    // Friend declarations don't introduce symbols — only `v_` shows up.
    const memberNames = result.symbols
      .filter((s) => s.parent === "b.Box")
      .map((s) => s.name);
    expect(memberNames).toEqual(["v_"]);
  });

  it("emits a nested class as a fully-qualified symbol under its outer class", async () => {
    const source = `
class Outer {
 public:
  class Inner {
   public:
    int v_;
  };
};
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "n.cpp");
    const inner = result.symbols.find(
      (s) => s.name === "Inner" && s.qualifiedName === "n.Outer.Inner",
    );
    expect(inner).toBeDefined();
    const v = result.symbols.find((s) => s.name === "v_");
    expect(v?.parent).toBe("n.Outer.Inner");
  });

  it("emits a nested enum under its outer class qualified name", async () => {
    const source = `
class Stateful {
 public:
  enum State { OK, ERR };
};
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "s.cpp");
    const state = result.symbols.find(
      (s) => s.name === "State" && s.qualifiedName === "s.Stateful.State",
    );
    expect(state?.kind).toBe("enum");
    const ok = result.symbols.find((s) => s.name === "OK");
    expect(ok?.parent).toBe("s.Stateful.State");
  });

  it("emits a nested alias declaration as a type symbol under the class", async () => {
    const source = `
class Container {
 public:
  using value_type = int;
};
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "c.cpp");
    const alias = result.symbols.find(
      (s) => s.name === "value_type" && s.qualifiedName === "c.Container.value_type",
    );
    expect(alias?.kind).toBe("type");
    expect(alias?.decorators).toContain("alias");
  });

  it("silently consumes `using Base::method` inside a class body", async () => {
    const source = `
class B { public: void f(); };
class D : public B {
 public:
  using B::f;
  void g();
};
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "d.cpp");
    // No additional symbol from the using-declaration; g and f are emitted as expected.
    const methods = result.symbols.filter((s) => s.parent === "d.D").map((s) => s.name);
    expect(methods).toEqual(["g"]);
  });

  it("emits a templated method declaration inside a class body", async () => {
    const source = `
class Container {
 public:
  template <typename U>
  U cast() const;
};
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "c.cpp");
    const cast = result.symbols.find((s) => s.name === "cast");
    expect(cast?.kind).toBe("method");
    expect(cast?.parent).toBe("c.Container");
    expect(cast?.decorators).toContain("template");
  });

  it("emits a function-pointer field with the function_pointer decorator", async () => {
    const source = `
class Callbacks {
 public:
  int (*on_open)(int);
};
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "c.cpp");
    const fp = result.symbols.find((s) => s.name === "on_open");
    expect(fp).toBeDefined();
    // Function pointer fields are surfaced as methods (matching the
    // C-family default).
    expect(fp?.kind).toBe("method");
  });
});

describe("CppExtractor — using-declaration edge cases", () => {
  it("handles a `using namespace foo::bar;` directive with a nested namespace specifier", async () => {
    const source = `using namespace foo::bar;`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "u.cpp");
    expect(result.imports).toEqual([
      { module: "foo.bar", names: [], isWildcard: true, line: 1 },
    ]);
  });
});

describe("CppExtractor — inherits the C subset transparently", () => {
  it("emits #include imports the same way as lang-c", async () => {
    const source = `
#include <vector>
#include "local.hpp"
`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "src/m.cpp");
    expect(result.imports).toEqual([
      { module: "<vector>", names: [], isWildcard: true, line: 2 },
      { module: "local.hpp", names: [], isWildcard: true, line: 3 },
    ]);
  });

  it("emits typedefs as type symbols (via the parent extractor)", async () => {
    const source = `typedef int counter_t;`;
    const tree = await parse(source);
    const result = new CppExtractor().extract(tree, source, "t.cpp");
    const t = result.symbols.find((s) => s.name === "counter_t");
    expect(t?.kind).toBe("type");
    expect(t?.decorators).toContain("typedef");
  });

  it("resolveImportPath delegates to the C-family resolver", () => {
    const ext = new CppExtractor();
    expect(ext.resolveImportPath("<vector>", "src/m.cpp")).toEqual([]);
    expect(ext.resolveImportPath("util.hpp", "src/m.cpp")).toEqual([
      "src/util.hpp",
      "util.hpp",
    ]);
  });
});
