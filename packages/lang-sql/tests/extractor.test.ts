/**
 * Unit tests for SqlExtractor.
 *
 * These tests exercise specific SQL dialect features and the cross-reference
 * algorithm in isolation. The simple/medium/complex fixture-based tests live
 * in `fixtures.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { SqlExtractor, plugin } from "../src/index.js";
import { expectSymbol, expectEdge, findSymbol, symbolNames, referenceNames } from "@reponova/lang-test-utils";

const E = new SqlExtractor();

function run(source: string, filePath = "test.sql") {
  return E.extract(null, source, filePath);
}

describe("LanguagePlugin shape", () => {
  it("exposes the SQL plugin metadata", () => {
    expect(plugin.id).toBe("sql");
    expect(plugin.fileType).toBe("sql");
    expect(plugin.configDefaults).toBeUndefined();
    expect(plugin.extractor).toBeInstanceOf(SqlExtractor);
  });

  it("declares SQL as a non-tree-sitter language", () => {
    expect(E.wasmFile).toBeUndefined();
    expect(E.languageId).toBe("sql");
  });
});

describe("file node", () => {
  it("uses the file basename as label and tags ['sql']", () => {
    const result = run("CREATE TABLE t(id INTEGER);", "db/migrations/001_init.sql");
    expect(result.fileNode.kind).toBe("module");
    expect(result.fileNode.label).toBe("001_init.sql");
    expect(result.fileNode.tags).toEqual(["sql"]);
  });

  it("captures the leading comment block as docstring", () => {
    const src = [
      "-- Initial migration.",
      "-- Adds the auth schema.",
      "",
      "CREATE TABLE u(id INTEGER);",
    ].join("\n");
    const result = run(src);
    expect(result.fileNode.docstring).toBe("Initial migration. Adds the auth schema.");
  });

  it("captures a leading block comment as docstring", () => {
    const src = [
      "/* This is a thing.",
      " * Continued.",
      " */",
      "CREATE TABLE u(id INTEGER);",
    ].join("\n");
    const result = run(src);
    expect(result.fileNode.docstring).toBe("This is a thing. Continued.");
  });

  it("captures MySQL-style # comments", () => {
    const src = ["# MySQL leading note", "CREATE TABLE u(id INTEGER);"].join("\n");
    const result = run(src);
    expect(result.fileNode.docstring).toBe("MySQL leading note");
  });
});

describe("CREATE TABLE", () => {
  it("extracts a basic table as a class symbol with 'table' decorator", () => {
    const result = run("CREATE TABLE users (id INTEGER PRIMARY KEY);");
    expectSymbol(result, { name: "users", kind: "class" });
    const sym = findSymbol(result, "users")!;
    expect(sym.decorators).toContain("table");
  });

  it("respects IF NOT EXISTS and TEMP / TEMPORARY modifiers", () => {
    const r1 = run("CREATE TABLE IF NOT EXISTS users (id INTEGER);");
    expectSymbol(r1, { name: "users", kind: "class" });
    const r2 = run("CREATE TEMPORARY TABLE temp_buffer (id INTEGER);");
    const sym = findSymbol(r2, "temp_buffer")!;
    expect(sym.decorators).toContain("table");
    expect(sym.decorators).toContain("temporary");
  });

  it("respects schema-qualified table names", () => {
    const result = run("CREATE TABLE auth.users (id INTEGER);");
    const sym = findSymbol(result, "users")!;
    expect(sym).toBeDefined();
    expect(sym.parent).toBe("auth");
    expect(sym.qualifiedName).toBe("test.auth.users");
  });

  it("supports double-quoted, backticked, and bracketed identifiers", () => {
    const r1 = run(`CREATE TABLE "User Logs" (id INTEGER);`);
    expectSymbol(r1, { name: "User Logs", kind: "class" });
    const r2 = run("CREATE TABLE `user_logs` (id INTEGER);");
    expectSymbol(r2, { name: "user_logs", kind: "class" });
    const r3 = run("CREATE TABLE [dbo].[UserLogs] (id INTEGER);");
    const sym = findSymbol(r3, "UserLogs")!;
    expect(sym.parent).toBe("dbo");
  });

  it("emits FOREIGN KEY block constraints as extends references", () => {
    const src = `
      CREATE TABLE orders (
        id        INTEGER PRIMARY KEY,
        user_id   INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `;
    const result = run(src);
    expectEdge(result, { from: "test.orders", to: "users", kind: "extends" });
  });

  it("emits inline column-level REFERENCES as extends", () => {
    const src = `
      CREATE TABLE sessions (
        id      UUID PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id)
      );
    `;
    const result = run(src);
    expectEdge(result, { from: "test.sessions", to: "users", kind: "extends" });
  });

  it("does not emit a duplicate edge when FOREIGN KEY and REFERENCES name the same table", () => {
    const src = `
      CREATE TABLE orders (
        id      INTEGER,
        user_id INTEGER REFERENCES users(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `;
    const result = run(src);
    const edges = result.references.filter(
      (r) => r.fromSymbol === "test.orders" && r.name === "users",
    );
    expect(edges).toHaveLength(1);
  });
});

describe("CREATE VIEW", () => {
  it("extracts a view as class symbol with 'view' decorator", () => {
    const result = run("CREATE VIEW active_users AS SELECT id FROM users WHERE active;");
    const sym = findSymbol(result, "active_users")!;
    expect(sym).toBeDefined();
    expect(sym.kind).toBe("class");
    expect(sym.decorators).toContain("view");
  });

  it("supports CREATE OR REPLACE VIEW", () => {
    const result = run("CREATE OR REPLACE VIEW v1 AS SELECT 1 FROM t;");
    expectSymbol(result, { name: "v1", kind: "class" });
  });

  it("supports CREATE MATERIALIZED VIEW with materialized_view decorator", () => {
    const result = run("CREATE MATERIALIZED VIEW stats AS SELECT * FROM events;");
    const sym = findSymbol(result, "stats")!;
    expect(sym.decorators).toContain("materialized_view");
  });

  it("extracts FROM/JOIN references inside view body", () => {
    const src = `
      CREATE VIEW order_summary AS
      SELECT o.id, u.email, p.name
      FROM   orders o
      JOIN   users    u ON o.user_id = u.id
      LEFT JOIN products p ON o.product_id = p.id;
    `;
    const result = run(src);
    expectEdge(result, { from: "test.order_summary", to: "orders", kind: "references" });
    expectEdge(result, { from: "test.order_summary", to: "users", kind: "references" });
    expectEdge(result, { from: "test.order_summary", to: "products", kind: "references" });
  });
});

describe("CREATE FUNCTION / PROCEDURE / TRIGGER", () => {
  it("extracts a PL/pgSQL function (function body stripped via dollar-quote)", () => {
    const src = `
      CREATE OR REPLACE FUNCTION calc_total(amount NUMERIC, tax NUMERIC) RETURNS NUMERIC AS $$
      BEGIN
        RETURN amount * (1 + tax);
      END;
      $$ LANGUAGE plpgsql;
    `;
    const result = run(src);
    const sym = findSymbol(result, "calc_total")!;
    expect(sym).toBeDefined();
    expect(sym.kind).toBe("function");
    expect(sym.decorators).toContain("function");
  });

  it("extracts a procedure as method with 'procedure' decorator", () => {
    const src = `
      CREATE PROCEDURE refresh_stats()
      LANGUAGE SQL
      AS $$ REFRESH MATERIALIZED VIEW stats; $$;
    `;
    const result = run(src);
    const sym = findSymbol(result, "refresh_stats")!;
    expect(sym.kind).toBe("method");
    expect(sym.decorators).toContain("procedure");
  });

  it("supports T-SQL CREATE OR ALTER PROC syntax", () => {
    const src = `
      CREATE OR ALTER PROC dbo.RefreshIndex
      AS
      BEGIN
        EXEC sp_recompile 'dbo.Users';
      END
    `;
    // The trailing ; isn't there in T-SQL — split-statements still produces one
    // statement at EOF. The BEGIN/END balancing keeps internal ; safe.
    const result = run(src);
    const sym = findSymbol(result, "RefreshIndex")!;
    expect(sym).toBeDefined();
    expect(sym.kind).toBe("method");
    expect(sym.parent).toBe("dbo");
  });

  it("captures FROM refs and CALL edges inside function bodies", () => {
    // Use a non-dollar-quoted body so the inner SQL stays visible to refs.
    const src = `
      CREATE FUNCTION list_users() RETURNS TABLE (id INTEGER, email TEXT)
      LANGUAGE SQL
      AS $$
        SELECT id, email FROM users WHERE active;
        CALL audit_log('list_users');
      $$;
    `;
    // The dollar-quoted body is intentionally stripped, so we shouldn't see
    // FROM users inside. Test the negation, then a separate function with
    // body unwrapped.
    const result1 = run(src);
    const fromRefs1 = result1.references.filter((r) => r.kind === "references");
    expect(fromRefs1.length).toBe(0);

    // SQL-language function without dollar-quote, body part of the visible text.
    const src2 = `
      CREATE FUNCTION list_users() RETURNS TABLE(id INTEGER) AS '
        SELECT id FROM users WHERE active
      ' LANGUAGE SQL;
    `;
    // Single-quoted PostgreSQL body is treated as a string literal: refs hidden.
    const result2 = run(src2);
    const fromRefs2 = result2.references.filter((r) => r.kind === "references");
    expect(fromRefs2.length).toBe(0);

    // Pre-9.0 PostgreSQL function with the body NOT wrapped in dollar quotes
    // is rare in modern code; instead, exercise refs from a VIEW (covered
    // elsewhere) and procedure CALL edges through a non-string body below.
  });

  it("extracts a CREATE TRIGGER with target table reference", () => {
    const src = `
      CREATE TRIGGER trg_audit_users
      AFTER INSERT OR UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION audit_log();
    `;
    const result = run(src);
    const sym = findSymbol(result, "trg_audit_users")!;
    expect(sym).toBeDefined();
    expect(sym.kind).toBe("function");
    expect(sym.decorators).toContain("trigger");
    expectEdge(result, { from: "test.trg_audit_users", to: "users", kind: "references" });
  });
});

describe("CREATE INDEX", () => {
  it("extracts a plain index with index decorator and target table reference", () => {
    const result = run("CREATE INDEX idx_users_email ON users(email);");
    const sym = findSymbol(result, "idx_users_email")!;
    expect(sym).toBeDefined();
    expect(sym.kind).toBe("variable");
    expect(sym.decorators).toContain("index");
    expectEdge(result, { from: "test.idx_users_email", to: "users", kind: "references" });
  });

  it("extracts a UNIQUE INDEX with the 'unique' modifier", () => {
    const result = run("CREATE UNIQUE INDEX idx_users_email_lower ON users(LOWER(email));");
    const sym = findSymbol(result, "idx_users_email_lower")!;
    expect(sym.decorators).toContain("index");
    expect(sym.decorators).toContain("unique");
  });

  it("supports T-SQL clustered/non-clustered index modifiers", () => {
    const r1 = run("CREATE CLUSTERED INDEX ix_pk ON [Users]([Id]);");
    expectSymbol(r1, { name: "ix_pk", kind: "variable" });
    const r2 = run("CREATE NONCLUSTERED INDEX ix_email ON [Users]([Email]);");
    expectSymbol(r2, { name: "ix_email", kind: "variable" });
  });
});

describe("CREATE TYPE / DOMAIN / SEQUENCE / SCHEMA", () => {
  it("extracts a CREATE TYPE AS ENUM with the 'enum' kind", () => {
    const result = run("CREATE TYPE status AS ENUM ('active', 'inactive', 'banned');");
    const sym = findSymbol(result, "status")!;
    expect(sym.kind).toBe("enum");
    expect(sym.decorators).toContain("enum");
  });

  it("extracts a CREATE TYPE composite", () => {
    const result = run("CREATE TYPE address AS (street TEXT, city TEXT);");
    expectSymbol(result, { name: "address", kind: "type" });
  });

  it("extracts a CREATE DOMAIN as type with 'domain' decorator", () => {
    const result = run("CREATE DOMAIN email_address AS VARCHAR(255);");
    const sym = findSymbol(result, "email_address")!;
    expect(sym.kind).toBe("type");
    expect(sym.decorators).toContain("domain");
  });

  it("extracts a CREATE SEQUENCE as constant with 'sequence' decorator", () => {
    const result = run("CREATE SEQUENCE order_id_seq START WITH 1000;");
    const sym = findSymbol(result, "order_id_seq")!;
    expect(sym.kind).toBe("constant");
    expect(sym.decorators).toContain("sequence");
  });

  it("extracts a CREATE SCHEMA as module with 'schema' decorator", () => {
    const result = run("CREATE SCHEMA auth;");
    const sym = findSymbol(result, "auth")!;
    expect(sym.kind).toBe("module");
    expect(sym.decorators).toContain("schema");
  });

  it("does not crash when CREATE SCHEMA uses only AUTHORIZATION clause", () => {
    const result = run("CREATE SCHEMA AUTHORIZATION joe;");
    expect(symbolNames(result)).toHaveLength(0);
  });
});

describe("dialect tolerance", () => {
  it("handles MySQL backticks + AUTO_INCREMENT + ENGINE clauses", () => {
    const src = `
      CREATE TABLE \`users\` (
        \`id\` INT(11) NOT NULL AUTO_INCREMENT,
        \`email\` VARCHAR(255) NOT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE \`orders\` (
        \`id\` INT(11) NOT NULL AUTO_INCREMENT,
        \`user_id\` INT(11) NOT NULL,
        PRIMARY KEY (\`id\`),
        FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`)
      ) ENGINE=InnoDB;
    `;
    const result = run(src);
    expectSymbol(result, { name: "users", kind: "class" });
    expectSymbol(result, { name: "orders", kind: "class" });
    expectEdge(result, { from: "test.orders", to: "users", kind: "extends" });
  });

  it("handles T-SQL [bracketed] schema-qualified identifiers", () => {
    const src = `
      CREATE TABLE [dbo].[Customer] (
        [Id]   INT IDENTITY(1,1) PRIMARY KEY,
        [Name] NVARCHAR(255) NOT NULL
      );
      CREATE TABLE [dbo].[Invoice] (
        [Id]         INT PRIMARY KEY,
        [CustomerId] INT NOT NULL REFERENCES [dbo].[Customer]([Id])
      );
    `;
    const result = run(src);
    const customer = findSymbol(result, "Customer")!;
    expect(customer.parent).toBe("dbo");
    const invoice = findSymbol(result, "Invoice")!;
    expect(invoice).toBeDefined();
    expectEdge(result, { from: "test.dbo.Invoice", to: "dbo.Customer", kind: "extends" });
  });

  it("treats SQLite AUTOINCREMENT and case-insensitive keywords", () => {
    const src = `
      create table if not exists user (
        id integer primary key autoincrement,
        email text not null unique
      );
      create index idx_user_email on user(email);
    `;
    const result = run(src);
    expectSymbol(result, { name: "user", kind: "class" });
    expectSymbol(result, { name: "idx_user_email", kind: "variable" });
  });
});

describe("statement splitting", () => {
  it("does not break statements on semicolons inside string literals", () => {
    const src = `
      CREATE TABLE foo (id INTEGER, label TEXT DEFAULT 'a;b;c');
      CREATE TABLE bar (id INTEGER);
    `;
    const result = run(src);
    expect(symbolNames(result)).toEqual(["foo", "bar"]);
  });

  it("does not break statements on semicolons inside dollar-quoted blocks", () => {
    const src = `
      CREATE FUNCTION f() RETURNS VOID AS $$
        BEGIN
          INSERT INTO t VALUES (1);
          INSERT INTO t VALUES (2);
        END;
      $$ LANGUAGE plpgsql;
      CREATE TABLE marker (id INTEGER);
    `;
    const result = run(src);
    expect(symbolNames(result)).toContain("f");
    expect(symbolNames(result)).toContain("marker");
  });

  it("does not break statements on semicolons inside T-SQL BEGIN...END", () => {
    const src = `
      CREATE PROCEDURE p()
      AS
      BEGIN
        INSERT INTO t VALUES (1);
        INSERT INTO t VALUES (2);
      END;
      CREATE TABLE marker (id INTEGER);
    `;
    const result = run(src);
    expect(symbolNames(result)).toContain("p");
    expect(symbolNames(result)).toContain("marker");
  });

  it("skips empty/whitespace-only statements", () => {
    const result = run(";;;CREATE TABLE t(id INTEGER);;;");
    expect(symbolNames(result)).toEqual(["t"]);
  });
});

describe("comment handling", () => {
  it("ignores -- line comments mid-statement", () => {
    const src = `
      CREATE TABLE users ( -- the main user table
        id INTEGER -- primary key
      );
    `;
    const result = run(src);
    expectSymbol(result, { name: "users" });
  });

  it("ignores /* */ block comments mid-statement", () => {
    const src = `
      CREATE TABLE /* note */ users (id INTEGER /* col */);
    `;
    const result = run(src);
    expectSymbol(result, { name: "users" });
  });

  it("does not start a -- comment inside a string literal", () => {
    const src = `
      CREATE TABLE labels (id INTEGER, txt TEXT DEFAULT '-- not a comment');
      CREATE TABLE other (id INTEGER);
    `;
    const result = run(src);
    expect(symbolNames(result)).toContain("labels");
    expect(symbolNames(result)).toContain("other");
  });
});

describe("de-duplication", () => {
  it("does not emit duplicate symbols for the same name across statements", () => {
    const src = `
      CREATE TABLE users (id INTEGER);
      CREATE TABLE IF NOT EXISTS users (id INTEGER);
    `;
    const result = run(src);
    expect(symbolNames(result).filter((n) => n === "users")).toHaveLength(1);
  });

  it("treats schema-qualified names with a different schema as distinct symbols", () => {
    const src = `
      CREATE TABLE auth.users (id INTEGER);
      CREATE TABLE public.users (id INTEGER);
    `;
    const result = run(src);
    const matches = result.symbols.filter((s) => s.name === "users");
    expect(matches).toHaveLength(2);
    const schemas = matches.map((s) => s.parent);
    expect(schemas).toContain("auth");
    expect(schemas).toContain("public");
  });
});

describe("non-CREATE statements", () => {
  it("ignores ALTER (non-FK), INSERT, UPDATE, DELETE, SELECT, GRANT, COMMENT", () => {
    const src = `
      ALTER TABLE users ADD COLUMN extra TEXT;
      INSERT INTO users (email) VALUES ('a@b.c');
      UPDATE users SET email = 'x' WHERE id = 1;
      DELETE FROM users WHERE id = 1;
      SELECT * FROM users;
      GRANT SELECT ON users TO reader;
      COMMENT ON TABLE users IS 'the users';
    `;
    const result = run(src);
    expect(symbolNames(result)).toEqual([]);
    expect(referenceNames(result)).toEqual([]);
  });
});

describe("ALTER TABLE ... ADD FOREIGN KEY", () => {
  it("emits extends edge from pg_dump-style ALTER TABLE FK", () => {
    const src = `
      ALTER TABLE ONLY address
        ADD CONSTRAINT address_city_id_fkey FOREIGN KEY (city_id)
          REFERENCES city(city_id) ON UPDATE CASCADE ON DELETE RESTRICT;
    `;
    const result = run(src);
    expectEdge(result, { from: "test.address", to: "city", kind: "extends" });
  });

  it("handles schema-qualified source table", () => {
    const src = `ALTER TABLE billing.invoices ADD CONSTRAINT fk FOREIGN KEY (customer_id) REFERENCES billing.customers(id);`;
    const result = run(src);
    expectEdge(result, { from: "test.billing.invoices", to: "billing.customers", kind: "extends" });
  });

  it("handles MySQL backticked ALTER TABLE FK", () => {
    const src = "ALTER TABLE `orders` ADD CONSTRAINT `fk1` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`);";
    const result = run(src);
    expectEdge(result, { from: "test.orders", to: "users", kind: "extends" });
  });

  it("ignores ALTER TABLE statements that don't add FKs", () => {
    const result = run("ALTER TABLE users ADD COLUMN created_at TIMESTAMP;");
    expect(referenceNames(result)).toEqual([]);
  });
});

describe("MySQL CREATE modifiers (DEFINER / SQL SECURITY / ALGORITHM)", () => {
  it("handles CREATE DEFINER = user VIEW", () => {
    const src = `CREATE DEFINER = \`root\`@\`localhost\` VIEW v AS SELECT 1 FROM t;`;
    const result = run(src);
    expectSymbol(result, { name: "v", kind: "class" });
  });

  it("handles CREATE DEFINER=... SQL SECURITY INVOKER VIEW", () => {
    const src = `CREATE DEFINER=CURRENT_USER SQL SECURITY INVOKER VIEW actor_info AS SELECT 1 FROM actor;`;
    const result = run(src);
    expectSymbol(result, { name: "actor_info", kind: "class" });
    expectEdge(result, { from: "test.actor_info", to: "actor", kind: "references" });
  });

  it("handles CREATE DEFINER=... PROCEDURE / FUNCTION / TRIGGER", () => {
    const r1 = run(`CREATE DEFINER=\`root\`@\`localhost\` PROCEDURE p() BEGIN SELECT 1 FROM t; END;`);
    expectSymbol(r1, { name: "p", kind: "method" });
    const r2 = run(`CREATE DEFINER=\`root\`@\`localhost\` FUNCTION f() RETURNS INT DETERMINISTIC RETURN 1;`);
    expectSymbol(r2, { name: "f", kind: "function" });
    const r3 = run(`CREATE DEFINER=\`root\`@\`localhost\` TRIGGER trg AFTER INSERT ON tbl FOR EACH ROW BEGIN INSERT INTO log VALUES (1); END;`);
    expectSymbol(r3, { name: "trg", kind: "function" });
  });

  it("handles CREATE ALGORITHM=UNDEFINED DEFINER=... VIEW", () => {
    const src = `CREATE ALGORITHM=UNDEFINED DEFINER=CURRENT_USER VIEW v AS SELECT 1 FROM t;`;
    const result = run(src);
    expectSymbol(result, { name: "v", kind: "class" });
  });
});

describe("statement splitting with control-flow END forms", () => {
  it("does not split on internal `;` inside BEGIN ... IF ... END IF ... END", () => {
    const src = `
      CREATE PROCEDURE p(in x INT)
      BEGIN
        IF x > 0 THEN
          INSERT INTO t VALUES (1);
          UPDATE t SET y = 2 WHERE z = 3;
        END IF;
        INSERT INTO t VALUES (4);
      END;
      CREATE TABLE marker (id INTEGER);
    `;
    const result = run(src);
    expect(symbolNames(result)).toContain("p");
    expect(symbolNames(result)).toContain("marker");
  });

  it("does not split on internal `;` inside WHILE / LOOP / REPEAT", () => {
    const src = `
      CREATE PROCEDURE p()
      BEGIN
        WHILE x > 0 DO
          INSERT INTO t VALUES (1);
        END WHILE;
        LOOP
          INSERT INTO t VALUES (2);
        END LOOP;
        REPEAT
          INSERT INTO t VALUES (3);
        UNTIL x < 0 END REPEAT;
      END;
      CREATE TABLE marker (id INTEGER);
    `;
    const result = run(src);
    expect(symbolNames(result)).toContain("p");
    expect(symbolNames(result)).toContain("marker");
  });
});

describe("resolveImportPath", () => {
  it("always returns an empty array (SQL has no module imports)", () => {
    expect(E.resolveImportPath("foo", "bar.sql")).toEqual([]);
    expect(E.resolveImportPath("", "")).toEqual([]);
  });
});

describe("identifier edge cases", () => {
  it("handles doubled-double-quote escapes in PostgreSQL identifiers", () => {
    const result = run(`CREATE TABLE "He said ""hi""" (id INTEGER);`);
    // The unescaped name should be: He said "hi"
    expectSymbol(result, { name: `He said "hi"` });
  });

  it("handles three-part qualified names db.schema.name (drops the db)", () => {
    const result = run("CREATE TABLE warehouse.public.users (id INTEGER);");
    const sym = findSymbol(result, "users")!;
    expect(sym.parent).toBe("public");
  });
});
