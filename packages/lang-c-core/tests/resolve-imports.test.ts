/**
 * Unit tests for the standalone `resolveCInclude` helper and the
 * `CFamilyExtractor.resolveImportPath` instance method (which is a
 * thin wrapper around `resolveCInclude`).
 *
 * `#include` resolution is hot-path code for the graph builder, so we
 * pin every shape exhaustively here rather than letting the fixture
 * suite be the only coverage.
 */

import { describe, it, expect } from "vitest";
import { CFamilyExtractor, resolveCInclude } from "../src/index.js";

function makeExtractor(): CFamilyExtractor {
  return new CFamilyExtractor({
    languageId: "c",
    extensions: [".c", ".h"],
    wasmFile: "tree-sitter-c.wasm",
  });
}

describe("resolveCInclude (standalone)", () => {
  it("returns no candidates for system includes (angle brackets)", () => {
    expect(resolveCInclude("<stdio.h>", "src/main.c")).toEqual([]);
    expect(resolveCInclude("<sys/types.h>", "src/main.c")).toEqual([]);
  });

  it("resolves a quoted include relative to the including file's directory", () => {
    expect(resolveCInclude("util.h", "src/main.c")).toEqual([
      "src/util.h",
      "util.h",
    ]);
  });

  it("walks parent directories for `../shared/util.h` style includes", () => {
    expect(resolveCInclude("../shared/util.h", "src/main.c")).toEqual([
      "shared/util.h",
      "../shared/util.h",
    ]);
  });

  it("dedupes when the relative and repo-root paths coincide", () => {
    // File at repo root → dirname is empty → relative-to-file === repo-root path.
    expect(resolveCInclude("util.h", "main.c")).toEqual(["util.h"]);
  });

  it("normalises Windows-style backslashes in the include path", () => {
    expect(resolveCInclude("sub\\util.h", "src/main.c")).toEqual([
      "src/sub/util.h",
      "sub/util.h",
    ]);
  });

  it("returns [] for empty input", () => {
    expect(resolveCInclude("", "src/main.c")).toEqual([]);
  });

  it("survives a file path with no directory component", () => {
    expect(resolveCInclude("util.h", "main.c")).toEqual(["util.h"]);
  });

  it("preserves nested path components in user includes", () => {
    expect(resolveCInclude("internal/buffer.h", "src/main.c")).toEqual([
      "src/internal/buffer.h",
      "internal/buffer.h",
    ]);
  });
});

describe("CFamilyExtractor.resolveImportPath (delegating wrapper)", () => {
  it("delegates to resolveCInclude for system includes", () => {
    const ext = makeExtractor();
    expect(ext.resolveImportPath("<stdio.h>", "src/main.c")).toEqual([]);
  });

  it("delegates to resolveCInclude for quoted includes", () => {
    const ext = makeExtractor();
    expect(ext.resolveImportPath("util.h", "src/main.c")).toEqual([
      "src/util.h",
      "util.h",
    ]);
  });
});
