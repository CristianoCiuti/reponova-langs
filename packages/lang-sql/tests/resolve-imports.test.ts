/**
 * `resolveImportPath` must always return an empty array — SQL has no
 * module/import semantics in any of the dialects we support (PostgreSQL,
 * MySQL, SQLite, T-SQL, BigQuery). Schema-qualified references are
 * captured as graph edges via `references[]`, not as imports.
 */
import { describe, it, expect } from "vitest";
import { SqlExtractor } from "../src/index.js";

const E = new SqlExtractor();

describe("SqlExtractor.resolveImportPath", () => {
  it("returns an empty array for any module string", () => {
    expect(E.resolveImportPath("foo", "bar.sql")).toEqual([]);
    expect(E.resolveImportPath("schema.table", "migrations/001_init.sql")).toEqual([]);
  });

  it("returns an empty array for empty inputs", () => {
    expect(E.resolveImportPath("", "")).toEqual([]);
  });

  it("returns an empty array for dotted, slashed, and quoted strings", () => {
    expect(E.resolveImportPath("a/b/c", "x.sql")).toEqual([]);
    expect(E.resolveImportPath("`foo`", "x.sql")).toEqual([]);
    expect(E.resolveImportPath('"foo"', "x.sql")).toEqual([]);
  });
});
