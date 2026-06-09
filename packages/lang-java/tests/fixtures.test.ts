/**
 * Fixture-based tests covering the simple / medium / complex tiers.
 *
 * These complement the inline-source tests in `extractor.test.ts` and
 * use real Java files on disk so we exercise the same grammar +
 * extractor combination consumers will hit.
 *
 * The complex/ tier is a verbatim snapshot of Apache Commons CLI 1.9.0
 * — see `tests/fixtures/complex/commons-cli-1.9.0/ATTRIBUTION.md` for
 * provenance.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { SyntaxTree } from "reponova";
import { plugin, JavaExtractor } from "../src/index.js";
import { loadFixture, loadGrammar } from "@reponova/lang-test-utils";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commonsRoot = resolve(packageRoot, "tests/fixtures/complex/commons-cli-1.9.0");

let grammar: Awaited<ReturnType<typeof loadGrammar>>;

beforeAll(async () => {
  grammar = await loadGrammar(plugin.grammarPath!);
  if (!grammar) throw new Error("tree-sitter-java.wasm not present; run `pnpm grammar-fetch`");
});

async function parse(source: string): Promise<SyntaxTree> {
  return grammar!.parse(source) as SyntaxTree;
}

function walkJavaFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith(".java")) {
        out.push(abs);
      }
    }
  }
  return out.sort();
}

describe("simple/Greeter.java fixture", () => {
  it("extracts the class, fields, constructors, and methods", async () => {
    const source = loadFixture(packageRoot, "simple/Greeter.java");
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "simple/Greeter.java");

    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("Greeter");
    expect(names).toContain("DEFAULT_PREFIX");
    expect(names).toContain("prefix");
    expect(names).toContain("greet");
    expect(names).toContain("english");

    const greeter = result.symbols.find((s) => s.name === "Greeter" && s.kind === "class");
    expect(greeter?.qualifiedName).toBe("com.example.simple.Greeter");
    expect(greeter?.decorators).toContain("public");
    expect(greeter?.decorators).toContain("final");

    const ctors = result.symbols.filter(
      (s) => s.qualifiedName === "com.example.simple.Greeter.Greeter" && s.kind === "method",
    );
    expect(ctors.length).toBe(2);
    for (const c of ctors) {
      expect(c.decorators).toContain("constructor");
      expect(c.decorators).toContain("public");
    }

    expect(result.imports.map((i) => i.module)).toContain("java.util");
    expect(result.exports).toContain("Greeter");
  });
});

describe("medium/Cache.java fixture", () => {
  it("captures nested types, records, enums, annotation interfaces, and generics", async () => {
    const source = loadFixture(packageRoot, "medium/Cache.java");
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "medium/Cache.java");

    // CacheModule outer + a representative slice of nested types.
    const expectedTypes = [
      "CacheModule",
      "Stats",
      "MissPolicy",
      "ThreadSafe",
      "Loader",
      "Cache",
      "InMemoryCache",
      "NoOpCache",
    ];
    const allTypeNames = result.symbols
      .filter((s) => ["class", "interface", "enum"].includes(s.kind))
      .map((s) => s.name);
    for (const t of expectedTypes) {
      expect(allTypeNames, `expected type ${t}`).toContain(t);
    }

    const stats = result.symbols.find((s) => s.name === "Stats");
    expect(stats?.kind).toBe("class");
    expect(stats?.decorators).toContain("record");

    const missPolicy = result.symbols.find((s) => s.name === "MissPolicy");
    expect(missPolicy?.kind).toBe("enum");

    const threadSafe = result.symbols.find((s) => s.name === "ThreadSafe");
    expect(threadSafe?.decorators).toContain("annotation");

    const loader = result.symbols.find((s) => s.name === "Loader");
    expect(loader?.kind).toBe("interface");
    expect(loader?.bases).toEqual(["Function"]);

    const inMem = result.symbols.find((s) => s.name === "InMemoryCache");
    expect(inMem?.kind).toBe("class");
    expect(inMem?.bases).toEqual(["Cache"]);
    expect(inMem?.decorators).toContain("ThreadSafe");

    const enumConsts = result.symbols
      .filter((s) => s.parent === "com.example.medium.CacheModule.MissPolicy" && s.kind === "constant")
      .map((s) => s.name)
      .sort();
    expect(enumConsts).toEqual(["LOAD_DEFAULT", "RETURN_NULL", "THROW"]);

    // Static import surfaces in the imports list.
    const staticImport = result.imports.find(
      (i) => i.module === "java.util.Collections" && i.names.includes("emptyMap"),
    );
    expect(staticImport).toBeDefined();

    // Method invocations should be captured as references.
    const callsFromGetOrLoad = result.references.filter(
      (r) =>
        r.kind === "calls" &&
        r.fromSymbol === "com.example.medium.CacheModule.Cache.getOrLoad",
    );
    expect(callsFromGetOrLoad.length).toBeGreaterThan(0);
  });

  it("emits extends edges for the cache hierarchy", async () => {
    const source = loadFixture(packageRoot, "medium/Cache.java");
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "medium/Cache.java");

    const extendsEdges = result.references.filter((r) => r.kind === "extends");
    const inMemEdges = extendsEdges.filter(
      (r) => r.fromSymbol === "com.example.medium.CacheModule.InMemoryCache",
    );
    expect(inMemEdges.map((r) => r.name)).toContain("Cache");

    const cacheEdges = extendsEdges.filter(
      (r) => r.fromSymbol === "com.example.medium.CacheModule.Cache",
    );
    expect(cacheEdges.map((r) => r.name)).toContain("AutoCloseable");
  });
});

describe("complex fixture: commons-cli 1.9.0", () => {
  it("snapshot has the expected file count and provenance metadata", () => {
    const files = walkJavaFiles(join(commonsRoot, "src"));
    expect(files.length).toBe(26);

    expect(existsSync(join(commonsRoot, "LICENSE"))).toBe(true);
    expect(existsSync(join(commonsRoot, "NOTICE"))).toBe(true);
    expect(existsSync(join(commonsRoot, "ATTRIBUTION.md"))).toBe(true);

    // Sanity: snapshot is roughly the size we expect (within an order of
    // magnitude). Guard against accidental truncation or duplicate copies.
    let totalBytes = 0;
    for (const f of files) totalBytes += statSync(f).size;
    expect(totalBytes).toBeGreaterThan(150_000);
    expect(totalBytes).toBeLessThan(400_000);
  });

  it("parses every file and emits non-empty extraction output", async () => {
    const files = walkJavaFiles(join(commonsRoot, "src"));

    let totalSymbols = 0;
    let totalImports = 0;
    let totalReferences = 0;
    let totalTypes = 0;
    let totalMethods = 0;

    for (const abs of files) {
      const rel = relative(commonsRoot, abs).split(sep).join("/");
      const source = readFileSync(abs, "utf8");
      const tree = await parse(source);
      const result = new JavaExtractor().extract(tree, source, rel);

      // package-info.java has no types but still has a package declaration
      // — its symbols list is allowed to be empty.
      if (!rel.endsWith("package-info.java")) {
        expect(result.symbols.length, `${rel}: expected symbols`).toBeGreaterThan(0);
      }

      totalSymbols += result.symbols.length;
      totalImports += result.imports.length;
      totalReferences += result.references.length;
      totalTypes += result.symbols.filter((s) =>
        ["class", "interface", "enum"].includes(s.kind),
      ).length;
      totalMethods += result.symbols.filter((s) => s.kind === "method").length;
    }

    // Invariant-based floor counts on the canonical Apache Commons CLI
    // 1.9.0 snapshot. Generous lower bounds — the actual numbers are
    // ~28 types, ~400 methods, ~750 symbols, ~60 imports, ~2k references
    // — so the floors should survive minor extractor refinements
    // without becoming flaky.
    expect(totalTypes).toBeGreaterThan(20);
    expect(totalMethods).toBeGreaterThan(200);
    expect(totalSymbols).toBeGreaterThan(500);
    expect(totalImports).toBeGreaterThan(40);
    expect(totalReferences).toBeGreaterThan(500);
  });

  it("extracts landmark Apache Commons CLI types from canonical files", async () => {
    const cases: Array<{ file: string; mustContain: string[] }> = [
      {
        file: "src/main/java/org/apache/commons/cli/Option.java",
        mustContain: ["Option", "Builder"],
      },
      {
        file: "src/main/java/org/apache/commons/cli/Options.java",
        mustContain: ["Options"],
      },
      {
        file: "src/main/java/org/apache/commons/cli/CommandLine.java",
        mustContain: ["CommandLine", "Builder"],
      },
      {
        file: "src/main/java/org/apache/commons/cli/DefaultParser.java",
        mustContain: ["DefaultParser"],
      },
      {
        file: "src/main/java/org/apache/commons/cli/HelpFormatter.java",
        mustContain: ["HelpFormatter"],
      },
      {
        file: "src/main/java/org/apache/commons/cli/Converter.java",
        mustContain: ["Converter"],
      },
    ];

    for (const c of cases) {
      const source = readFileSync(join(commonsRoot, c.file), "utf8");
      const tree = await parse(source);
      const result = new JavaExtractor().extract(tree, source, c.file);
      const typeNames = result.symbols
        .filter((s) => ["class", "interface", "enum"].includes(s.kind))
        .map((s) => s.name);
      for (const landmark of c.mustContain) {
        expect(typeNames, `${c.file}: expected type ${landmark}`).toContain(landmark);
      }
    }
  });

  it("captures the ParseException → IOException hierarchy", async () => {
    const source = readFileSync(
      join(commonsRoot, "src/main/java/org/apache/commons/cli/ParseException.java"),
      "utf8",
    );
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "ParseException.java");
    const exn = result.symbols.find((s) => s.name === "ParseException");
    expect(exn?.kind).toBe("class");
    expect(exn?.bases).toBeDefined();
    // Upstream extends java.lang.Exception (checked exception).
    expect(exn?.bases).toContain("Exception");

    // The other exception files in the package each extend either
    // ParseException directly OR a sibling that does — AmbiguousOption is
    // the only one that goes through UnrecognizedOptionException.
    const derivedDirect = [
      "AlreadySelectedException.java",
      "MissingArgumentException.java",
      "MissingOptionException.java",
      "UnrecognizedOptionException.java",
    ];
    for (const f of derivedDirect) {
      const src = readFileSync(
        join(commonsRoot, `src/main/java/org/apache/commons/cli/${f}`),
        "utf8",
      );
      const t = await parse(src);
      const r = new JavaExtractor().extract(t, src, f);
      const cls = r.symbols.find((s) => s.kind === "class" && s.parent === undefined);
      expect(cls?.bases, `${f}: expected to extend ParseException`).toContain("ParseException");
    }

    const ambiguousSrc = readFileSync(
      join(commonsRoot, "src/main/java/org/apache/commons/cli/AmbiguousOptionException.java"),
      "utf8",
    );
    const ambiguousTree = await parse(ambiguousSrc);
    const ambiguousResult = new JavaExtractor().extract(
      ambiguousTree,
      ambiguousSrc,
      "AmbiguousOptionException.java",
    );
    const ambiguousCls = ambiguousResult.symbols.find(
      (s) => s.name === "AmbiguousOptionException" && s.kind === "class",
    );
    expect(ambiguousCls?.bases).toContain("UnrecognizedOptionException");
  });

  it("captures the parser inheritance: DefaultParser, BasicParser, GnuParser, PosixParser extend Parser", async () => {
    // BasicParser, GnuParser, PosixParser all extend Parser. DefaultParser
    // implements CommandLineParser directly. Verify the right shape.
    const parserCases: Array<{ file: string; expectedBase: string }> = [
      { file: "BasicParser.java", expectedBase: "Parser" },
      { file: "GnuParser.java", expectedBase: "Parser" },
      { file: "PosixParser.java", expectedBase: "Parser" },
    ];
    for (const c of parserCases) {
      const source = readFileSync(
        join(commonsRoot, `src/main/java/org/apache/commons/cli/${c.file}`),
        "utf8",
      );
      const tree = await parse(source);
      const result = new JavaExtractor().extract(tree, source, c.file);
      const cls = result.symbols.find((s) => s.kind === "class" && s.parent === undefined);
      expect(cls?.bases, `${c.file}: expected to extend ${c.expectedBase}`).toContain(
        c.expectedBase,
      );
    }

    const defaultParserSrc = readFileSync(
      join(commonsRoot, "src/main/java/org/apache/commons/cli/DefaultParser.java"),
      "utf8",
    );
    const defaultParserTree = await parse(defaultParserSrc);
    const defaultParserResult = new JavaExtractor().extract(
      defaultParserTree,
      defaultParserSrc,
      "DefaultParser.java",
    );
    const dp = defaultParserResult.symbols.find(
      (s) => s.name === "DefaultParser" && s.kind === "class",
    );
    expect(dp?.bases).toContain("CommandLineParser");
  });

  it("emits a calls reference for static helper invocations across Util.java", async () => {
    const source = readFileSync(
      join(commonsRoot, "src/main/java/org/apache/commons/cli/Util.java"),
      "utf8",
    );
    const tree = await parse(source);
    const result = new JavaExtractor().extract(tree, source, "Util.java");

    const calls = result.references.filter((r) => r.kind === "calls");
    // Generous floor — Util.java is tiny but has nested helper calls.
    expect(calls.length).toBeGreaterThan(0);
  });
});
