/**
 * Fixture-based tests covering the simple / medium / complex tiers.
 *
 * The complex/ tier is a SHA-pinned snapshot of `jOOQ/sakila` at commit
 * `e089a5b1ec9af0df7a9c6a5d47d49fa1736a4e84` (BSD 2-Clause). See
 * `tests/fixtures/complex/sakila-e089a5b/ATTRIBUTION.md` for provenance.
 *
 * Assertions on the complex tier are invariant-based per the language
 * plugin roadmap §5.4: parse-time budget, no throws, fileNode shape,
 * symbol/edge floor counts, and selected landmark symbols. They are NOT
 * an exact graph snapshot — upstream additions / formatting nits should
 * not break the gate.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SqlExtractor } from "../src/index.js";
import {
  expectEdge,
  expectSymbol,
  findSymbol,
  loadFixture,
  symbolNames,
} from "@reponova/lang-test-utils";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const complexRoot = resolve(packageRoot, "tests/fixtures/complex/sakila-e089a5b");

const ext = new SqlExtractor();

describe("simple/users.sql fixture", () => {
  it("captures the leading docstring, tables, view, and FK references", () => {
    const source = loadFixture(packageRoot, "simple/users.sql");
    const result = ext.extract(null, source, "simple/users.sql");

    expect(result.fileNode.kind).toBe("module");
    expect(result.fileNode.tags).toEqual(["sql"]);
    expect(result.fileNode.docstring).toContain("Minimal user/auth schema");

    const names = symbolNames(result);
    expect(names).toEqual(
      expect.arrayContaining([
        "users",
        "sessions",
        "idx_sessions_user_id",
        "idx_users_email_lower",
        "active_sessions",
      ]),
    );

    const users = findSymbol(result, "users")!;
    expect(users.kind).toBe("class");
    expect(users.decorators).toContain("table");

    const idx = findSymbol(result, "idx_users_email_lower")!;
    expect(idx.decorators).toContain("index");
    expect(idx.decorators).toContain("unique");

    expectEdge(result, {
      from: "simple.users.sessions",
      to: "users",
      kind: "extends",
    });

    expectEdge(result, {
      from: "simple.users.active_sessions",
      to: "sessions",
      kind: "references",
    });
    expectEdge(result, {
      from: "simple.users.active_sessions",
      to: "users",
      kind: "references",
    });
  });
});

describe("medium/postgres-erp.sql fixture", () => {
  it("captures schemas, enums, domains, sequences, tables, views, MV, triggers, procedures", () => {
    const source = loadFixture(packageRoot, "medium/postgres-erp.sql");
    const result = ext.extract(null, source, "medium/postgres-erp.sql");

    const names = symbolNames(result);
    expect(names).toEqual(
      expect.arrayContaining([
        "auth", // schema
        "billing", // schema
        "user_role", // enum
        "money_amount", // domain
        "invoice_number_seq", // sequence
        "users", // tables
        "customers",
        "products",
        "invoices",
        "invoice_lines",
        "unpaid_invoices", // view
        "monthly_revenue", // materialised view
        "touch_invoice_totals", // function (trigger body)
        "trg_recalc_invoice_total", // trigger
        "refresh_monthly_revenue", // procedure
      ]),
    );

    const userRole = findSymbol(result, "user_role")!;
    expect(userRole.kind).toBe("enum");
    expect(userRole.parent).toBe("auth");

    const moneyAmount = findSymbol(result, "money_amount")!;
    expect(moneyAmount.kind).toBe("type");
    expect(moneyAmount.decorators).toContain("domain");

    const monthly = findSymbol(result, "monthly_revenue")!;
    expect(monthly.decorators).toContain("materialized_view");

    // FK edges across schemas.
    expectEdge(result, {
      from: "medium.postgres-erp.billing.customers",
      to: "auth.users",
      kind: "extends",
    });
    expectEdge(result, {
      from: "medium.postgres-erp.billing.invoices",
      to: "billing.customers",
      kind: "extends",
    });
    expectEdge(result, {
      from: "medium.postgres-erp.billing.invoice_lines",
      to: "billing.invoices",
      kind: "extends",
    });
  });
});

describe("medium/mysql-shop.sql fixture", () => {
  it("captures backticked tables, multi-column PKs, and FK extends edges", () => {
    const source = loadFixture(packageRoot, "medium/mysql-shop.sql");
    const result = ext.extract(null, source, "medium/mysql-shop.sql");

    const names = symbolNames(result);
    expect(names).toEqual(
      expect.arrayContaining([
        "categories",
        "customers",
        "products",
        "orders",
        "order_items",
        "v_customer_orders",
        "cleanup_cancelled_orders",
      ]),
    );

    const proc = findSymbol(result, "cleanup_cancelled_orders")!;
    expect(proc.kind).toBe("method");
    expect(proc.decorators).toContain("procedure");

    // Self-referential FK (categories parent).
    expectEdge(result, {
      from: "medium.mysql-shop.categories",
      to: "categories",
      kind: "extends",
    });
    // Multi-FK in order_items.
    expectEdge(result, {
      from: "medium.mysql-shop.order_items",
      to: "orders",
      kind: "extends",
    });
    expectEdge(result, {
      from: "medium.mysql-shop.order_items",
      to: "products",
      kind: "extends",
    });
  });
});

describe("medium/sqlserver-billing.sql fixture", () => {
  it("captures T-SQL [bracketed] schema-qualified tables and a CREATE OR ALTER PROC", () => {
    const source = loadFixture(packageRoot, "medium/sqlserver-billing.sql");
    const result = ext.extract(null, source, "medium/sqlserver-billing.sql");

    const account = findSymbol(result, "Account")!;
    expect(account).toBeDefined();
    expect(account.parent).toBe("dbo");

    const recordPayment = findSymbol(result, "RecordPayment")!;
    expect(recordPayment).toBeDefined();
    expect(recordPayment.kind).toBe("method");
    expect(recordPayment.parent).toBe("dbo");

    expectEdge(result, {
      from: "medium.sqlserver-billing.dbo.Invoice",
      to: "dbo.Account",
      kind: "extends",
    });
    expectEdge(result, {
      from: "medium.sqlserver-billing.dbo.Payment",
      to: "dbo.Invoice",
      kind: "extends",
    });

    // The view references both base tables.
    expectEdge(result, {
      from: "medium.sqlserver-billing.dbo.UnpaidInvoices",
      to: "dbo.Invoice",
      kind: "references",
    });
    expectEdge(result, {
      from: "medium.sqlserver-billing.dbo.UnpaidInvoices",
      to: "dbo.Account",
      kind: "references",
    });

    // The CALL inside RecordPayment becomes a `calls` edge.
    expectEdge(result, {
      from: "medium.sqlserver-billing.dbo.RecordPayment",
      to: "dbo.NotifyAccount",
      kind: "calls",
    });
  });
});

describe("complex/ tier: jOOQ/sakila @ e089a5b snapshot", () => {
  function listSqlFiles(): string[] {
    return readdirSync(complexRoot)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  }

  it("ships ATTRIBUTION.md + LICENSE alongside the fixture", () => {
    const entries = readdirSync(complexRoot);
    expect(entries).toContain("ATTRIBUTION.md");
    expect(entries).toContain("LICENSE");
  });

  it("ships both PostgreSQL and MySQL schema files", () => {
    const files = listSqlFiles();
    expect(files).toContain("postgres-sakila-schema.sql");
    expect(files).toContain("mysql-sakila-schema.sql");
  });

  it("every .sql file parses without throwing and emits a valid fileNode under budget", () => {
    const files = listSqlFiles();
    expect(files.length).toBeGreaterThan(0);

    const start = Date.now();
    for (const f of files) {
      const source = readFileSync(join(complexRoot, f), "utf8");
      const fp = `complex/${f}`;
      expect(() => ext.extract(null, source, fp), `${f}: should not throw`).not.toThrow();
      const result = ext.extract(null, source, fp);
      expect(result.fileNode.kind, `${f}: fileNode.kind`).toBe("module");
      expect(result.fileNode.tags?.[0], `${f}: first tag`).toBe("sql");
      expect(result.language, `${f}: language`).toBe("sql");
    }
    const elapsedMs = Date.now() - start;
    // Parse-time budget per §5.4: must be well under 5s for 2 ~50 KB files.
    expect(elapsedMs, `complex tier parse-time budget`).toBeLessThan(5000);
  });

  describe("postgres-sakila-schema.sql invariants", () => {
    const fp = "complex/postgres-sakila-schema.sql";
    const source = readFileSync(join(complexRoot, "postgres-sakila-schema.sql"), "utf8");
    const result = ext.extract(null, source, fp);

    it("extracts the 14 canonical Sakila tables plus partition children", () => {
      // Canonical Sakila tables. Partitioned `payment_p2007_*` tables are
      // an upstream PostgreSQL specificity — count separately.
      const canonical = [
        "actor", "address", "category", "city", "country", "customer",
        "film", "film_actor", "film_category", "inventory", "language",
        "payment", "rental", "staff", "store",
      ];
      const tables = result.symbols
        .filter((s) => s.decorators?.[0] === "table")
        .map((s) => s.name);
      for (const t of canonical) {
        expect(tables, `expected table ${t}`).toContain(t);
      }
    });

    it("extracts the 7 canonical Sakila views", () => {
      const canonical = [
        "actor_info",
        "customer_list",
        "film_list",
        "nicer_but_slower_film_list",
        "sales_by_film_category",
        "sales_by_store",
        "staff_list",
      ];
      const views = result.symbols
        .filter((s) => s.decorators?.[0] === "view")
        .map((s) => s.name);
      for (const v of canonical) {
        expect(views, `expected view ${v}`).toContain(v);
      }
    });

    it("extracts the mpaa ENUM type and year DOMAIN", () => {
      expectSymbol(result, { name: "mpaa_rating", kind: "enum" });
      expectSymbol(result, { name: "year", kind: "type" });
    });

    it("extracts at least 6 functions", () => {
      const functions = result.symbols.filter(
        (s) => s.decorators?.[0] === "function",
      );
      expect(functions.length).toBeGreaterThanOrEqual(6);
    });

    it("extracts at least 13 sequences", () => {
      const seqs = result.symbols.filter((s) => s.decorators?.[0] === "sequence");
      expect(seqs.length).toBeGreaterThanOrEqual(13);
    });

    it("extracts at least 10 FK extends edges from pg_dump-style ALTER TABLE", () => {
      const fks = result.references.filter((r) => r.kind === "extends");
      expect(fks.length).toBeGreaterThanOrEqual(10);
    });

    it("captures landmark FK edges (address->city, city->country, film_actor->actor)", () => {
      const fks = result.references
        .filter((r) => r.kind === "extends")
        .map((r) => `${r.fromSymbol.split(".").pop()}->${r.name}`);
      expect(fks).toContain("address->city");
      expect(fks).toContain("city->country");
      expect(fks).toContain("film_actor->actor");
      expect(fks).toContain("film_actor->film");
    });

    it("uses the leading dump banner as the file docstring", () => {
      expect(result.fileNode.docstring).toContain("PostgreSQL database dump");
    });
  });

  describe("mysql-sakila-schema.sql invariants", () => {
    const fp = "complex/mysql-sakila-schema.sql";
    const source = readFileSync(join(complexRoot, "mysql-sakila-schema.sql"), "utf8");
    const result = ext.extract(null, source, fp);

    it("extracts the sakila SCHEMA as a module symbol", () => {
      const schema = findSymbol(result, "sakila")!;
      expect(schema).toBeDefined();
      expect(schema.kind).toBe("module");
      expect(schema.decorators).toContain("schema");
    });

    it("extracts the 16 canonical MySQL Sakila tables (including film_text)", () => {
      const canonical = [
        "actor", "address", "category", "city", "country", "customer",
        "film", "film_actor", "film_category", "film_text", "inventory",
        "language", "payment", "rental", "staff", "store",
      ];
      const tables = result.symbols
        .filter((s) => s.decorators?.[0] === "table")
        .map((s) => s.name);
      for (const t of canonical) {
        expect(tables, `expected table ${t}`).toContain(t);
      }
    });

    it("captures the 3 film triggers via DELIMITER ;; blocks", () => {
      const triggers = result.symbols
        .filter((s) => s.decorators?.[0] === "trigger")
        .map((s) => s.name);
      expect(triggers).toEqual(
        expect.arrayContaining(["ins_film", "upd_film", "del_film"]),
      );
    });

    it("captures procedures + functions through DELIMITER // and DELIMITER $$ blocks", () => {
      const procs = result.symbols.filter((s) => s.decorators?.[0] === "procedure");
      const funcs = result.symbols.filter((s) => s.decorators?.[0] === "function");
      expect(procs.map((s) => s.name)).toEqual(
        expect.arrayContaining(["rewards_report", "film_in_stock", "film_not_in_stock"]),
      );
      expect(funcs.map((s) => s.name)).toEqual(
        expect.arrayContaining([
          "get_customer_balance",
          "inventory_held_by_customer",
          "inventory_in_stock",
        ]),
      );
    });

    it("captures the actor_info view declared with CREATE DEFINER=... SQL SECURITY INVOKER", () => {
      expectSymbol(result, { name: "actor_info", kind: "class" });
    });

    it("extracts FK extends edges from inline column-level REFERENCES", () => {
      const fks = result.references
        .filter((r) => r.kind === "extends")
        .map((r) => `${r.fromSymbol.split(".").pop()}->${r.name}`);
      expect(fks).toContain("address->city");
      expect(fks).toContain("city->country");
      expect(fks).toContain("film_actor->actor");
    });
  });

  it("aggregate counts across both schemas are non-trivial and stable", () => {
    let totalSymbols = 0;
    let totalReferences = 0;
    let totalFKs = 0;
    let totalQueryRefs = 0;
    for (const f of listSqlFiles()) {
      const source = readFileSync(join(complexRoot, f), "utf8");
      const result = ext.extract(null, source, `complex/${f}`);
      totalSymbols += result.symbols.length;
      totalReferences += result.references.length;
      totalFKs += result.references.filter((r) => r.kind === "extends").length;
      totalQueryRefs += result.references.filter((r) => r.kind === "references").length;
    }
    // Across 2 ~50 KB Sakila files we should pull at least ~80 symbols
    // (tables + views + functions + indexes + sequences + 1 schema),
    // ~50 FK edges, and ~80 query refs (FROM/JOIN). These are floors —
    // upstream additions can only raise them.
    expect(totalSymbols).toBeGreaterThanOrEqual(80);
    expect(totalReferences).toBeGreaterThanOrEqual(120);
    expect(totalFKs).toBeGreaterThanOrEqual(50);
    expect(totalQueryRefs).toBeGreaterThanOrEqual(80);
  });
});
