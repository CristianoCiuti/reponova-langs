/**
 * Unit tests for the standalone helpers exported by `@reponova/lang-c-core`.
 *
 * These helpers are also used by the `CFamilyExtractor` itself; we test
 * them directly so non-extractor callers (graph builders, scripts, the
 * lang-cpp subclass) can rely on the documented semantics without
 * having to instantiate an extractor and parse a tree.
 */

import { describe, it, expect } from "vitest";
import {
  posixBasename,
  posixDirname,
  posixJoin,
  filePathToModule,
  stripStringQuotes,
  cleanDoxyBlock,
  stripBlockComment,
  stripLineDoxy,
  cleanFirstLine,
  truncate,
} from "../src/index.js";

describe("posix path helpers", () => {
  it("posixBasename returns the last segment", () => {
    expect(posixBasename("src/util/foo.c")).toBe("foo.c");
    expect(posixBasename("foo.c")).toBe("foo.c");
    expect(posixBasename("a/b/")).toBe("");
  });

  it("posixBasename normalises Windows backslashes", () => {
    expect(posixBasename("src\\util\\foo.c")).toBe("foo.c");
  });

  it("posixDirname returns everything before the last separator", () => {
    expect(posixDirname("src/util/foo.c")).toBe("src/util");
    expect(posixDirname("foo.c")).toBe("");
  });

  it("posixDirname normalises Windows backslashes", () => {
    expect(posixDirname("src\\util\\foo.c")).toBe("src/util");
  });

  it("posixJoin joins and normalises segments", () => {
    expect(posixJoin("a", "b", "c")).toBe("a/b/c");
    expect(posixJoin("a/", "/b/", "/c")).toBe("a/b/c");
    expect(posixJoin("a", ".", "b")).toBe("a/b");
    expect(posixJoin("a", "..", "b")).toBe("b");
    expect(posixJoin("a", "b", "..", "c")).toBe("a/c");
  });

  it("posixJoin keeps unresolvable `..` segments at the front", () => {
    expect(posixJoin("..", "..", "x")).toBe("../../x");
  });

  it("posixJoin yields an empty string for empty inputs", () => {
    expect(posixJoin()).toBe("");
    expect(posixJoin("", "", "")).toBe("");
  });
});

describe("filePathToModule", () => {
  it("converts a POSIX file path into a dotted module name", () => {
    expect(filePathToModule("src/util.c")).toBe("src.util");
    expect(filePathToModule("include/foo/bar.h")).toBe("include.foo.bar");
  });

  it("strips the file extension", () => {
    expect(filePathToModule("a/b.h")).toBe("a.b");
    expect(filePathToModule("a/b.cpp")).toBe("a.b");
  });

  it("normalises Windows backslashes", () => {
    expect(filePathToModule("src\\util.c")).toBe("src.util");
  });

  it("handles a bare filename without a directory", () => {
    expect(filePathToModule("util.c")).toBe("util");
  });

  it("collapses consecutive dots", () => {
    expect(filePathToModule("a/b..c.h")).toBe("a.b.c");
  });
});

describe("string helpers", () => {
  it("stripStringQuotes strips paired double quotes", () => {
    expect(stripStringQuotes('"hello"')).toBe("hello");
    expect(stripStringQuotes("hello")).toBe("hello");
    expect(stripStringQuotes('"')).toBe('"');
  });

  it("truncate caps a string with an ellipsis at the boundary", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("abcdefghij", 5)).toBe("ab...");
    expect(truncate("abcde", 5)).toBe("abcde");
  });

  it("cleanFirstLine trims and ellipsises long content", () => {
    expect(cleanFirstLine("  hello  ")).toBe("hello");
    expect(cleanFirstLine("")).toBeUndefined();
    expect(cleanFirstLine("a".repeat(310))).toMatch(/\.\.\.$/);
  });
});

describe("doxygen / comment helpers", () => {
  it("cleanDoxyBlock extracts the first summary line from `/** ... */`", () => {
    expect(cleanDoxyBlock("/** Hello world. */")).toBe("Hello world.");
    expect(
      cleanDoxyBlock(`/**
 * Summary line.
 * Detail line.
 */`),
    ).toBe("Summary line.");
  });

  it("cleanDoxyBlock handles `/*!` Doxy blocks", () => {
    expect(cleanDoxyBlock("/*! Summary. */")).toBe("Summary.");
  });

  it("cleanDoxyBlock skips @tag and \\tag prefixed lines", () => {
    expect(
      cleanDoxyBlock(`/**
 * @param x value
 * Actual summary.
 */`),
    ).toBe("Actual summary.");
    expect(
      cleanDoxyBlock(`/**
 * \\brief Brief.
 * Real summary.
 */`),
    ).toBe("Real summary.");
  });

  it("cleanDoxyBlock returns undefined when nothing extractable", () => {
    expect(cleanDoxyBlock("/** */")).toBeUndefined();
    expect(
      cleanDoxyBlock(`/**
 * @tag1
 * @tag2
 */`),
    ).toBeUndefined();
  });

  it("stripBlockComment extracts the first text line from a `/* ... */` block", () => {
    expect(
      stripBlockComment(`/*
 * Copyright notice.
 * (c) 2026
 */`),
    ).toBe("Copyright notice.");
  });

  it("stripLineDoxy strips `///` or `//!` prefix", () => {
    expect(stripLineDoxy("/// hello")).toBe("hello");
    expect(stripLineDoxy("//! hello")).toBe("hello");
    expect(stripLineDoxy("////// hello")).toBe("hello");
  });
});
