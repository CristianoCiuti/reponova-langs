/**
 * Import-resolution tests for the C++ plugin. Resolution semantics
 * are identical to `@reponova/lang-c` (the same `#include` rules
 * apply), so we verify the C++ plugin's `resolveImportPath` is wired
 * straight through to the C-family resolver without surprises.
 */

import { describe, it, expect } from "vitest";
import { CppExtractor } from "../src/index.js";

const ext = new CppExtractor();

describe("CppExtractor.resolveImportPath", () => {
  it("returns no candidates for system includes", () => {
    expect(ext.resolveImportPath("<vector>", "src/main.cpp")).toEqual([]);
    expect(ext.resolveImportPath("<bits/stdc++.h>", "src/main.cpp")).toEqual([]);
  });

  it("resolves a quoted include relative to the including file's directory", () => {
    expect(ext.resolveImportPath("util.hpp", "src/main.cpp")).toEqual([
      "src/util.hpp",
      "util.hpp",
    ]);
  });

  it("walks parent directories for `../shared/util.hpp` style includes", () => {
    expect(ext.resolveImportPath("../shared/util.hpp", "src/main.cpp")).toEqual([
      "shared/util.hpp",
      "../shared/util.hpp",
    ]);
  });

  it("dedupes when the relative and repo-root paths coincide", () => {
    expect(ext.resolveImportPath("util.hpp", "main.cpp")).toEqual(["util.hpp"]);
  });

  it("normalises Windows-style backslashes in the include path", () => {
    expect(ext.resolveImportPath("sub\\util.hpp", "src/main.cpp")).toEqual([
      "src/sub/util.hpp",
      "sub/util.hpp",
    ]);
  });

  it("returns [] for empty input", () => {
    expect(ext.resolveImportPath("", "src/main.cpp")).toEqual([]);
  });

  it("preserves nested path components in user includes", () => {
    expect(ext.resolveImportPath("internal/buffer.hpp", "src/main.cpp")).toEqual([
      "src/internal/buffer.hpp",
      "internal/buffer.hpp",
    ]);
  });

  it("resolves header-only library includes that share a `.h` extension", () => {
    expect(ext.resolveImportPath("doctest.h", "tests/main.cpp")).toEqual([
      "tests/doctest.h",
      "doctest.h",
    ]);
  });
});
