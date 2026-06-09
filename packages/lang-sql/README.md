# @reponova/lang-sql

SQL language support for [RepoNova](https://github.com/CristianoCiuti/reponova). Regex-based, statement-oriented parser — no tree-sitter grammar required.

Multi-dialect tolerant by design: **PostgreSQL**, **MySQL**, **SQLite**, **T-SQL (SQL Server)**, and **BigQuery / Snowflake** all share one extractor. The plugin focuses on the *schema-level DDL surface* RepoNova's knowledge graph cares about (tables, views, functions, procedures, triggers, indexes, types, sequences, schemas) plus the cross-references between them. Query-body analysis is intentionally out of scope.

## Install

```bash
reponova lang add @reponova/lang-sql
```

## What it extracts

The extractor pre-processes the source (strips comments, neutralises string literals and PostgreSQL dollar-quoted bodies, honours MySQL `DELIMITER ;;` / `//` / `$$` directives), splits the source into top-level statements, then dispatches each `CREATE` / `ALTER` statement to a per-construct regex matcher.

### Symbols (`fileNode.kind` is always `"module"`; tagged `["sql"]`)

| SQL construct | `SymbolNode.kind` | First decorator | Notes |
| --- | --- | --- | --- |
| `CREATE TABLE` (incl. `TEMP`, `UNLOGGED`, `FOREIGN`, `VIRTUAL`) | `class` | `table` | Modifier captured as a secondary decorator (`temporary`, `unlogged`, …). Schema-qualified names produce `parent: "<schema>"`. |
| `CREATE VIEW` | `class` | `view` | |
| `CREATE MATERIALIZED VIEW` | `class` | `materialized_view` | |
| `CREATE FUNCTION` | `function` | `function` | PostgreSQL PL/pgSQL bodies (between `$$ … $$`) are neutralised — symbols inside are not extracted. |
| `CREATE PROCEDURE` / `PROC` | `method` | `procedure` | Supports `CREATE OR ALTER PROC` (T-SQL) and `CREATE DEFINER=… PROCEDURE` (MySQL). |
| `CREATE TRIGGER` | `function` | `trigger` | Target table captured as a `references` edge. |
| `CREATE [UNIQUE] INDEX` (incl. `CLUSTERED`, `NONCLUSTERED`, `BITMAP`, `FULLTEXT`, `SPATIAL`) | `variable` | `index` | `unique` carried as a secondary decorator. Target table captured as a `references` edge. |
| `CREATE TYPE … AS ENUM` | `enum` | `enum` | |
| `CREATE TYPE` (composite / range / object) | `type` | `type` | |
| `CREATE DOMAIN` | `type` | `domain` | |
| `CREATE SEQUENCE` | `constant` | `sequence` | |
| `CREATE SCHEMA` | `module` | `schema` | `CREATE SCHEMA AUTHORIZATION user` (no explicit name) is silently skipped. |

### Cross-references

| Source | Target | Edge `kind` |
| --- | --- | --- |
| `FOREIGN KEY (col) REFERENCES other(col)` (in `CREATE TABLE` body) | other table | `extends` |
| Inline column-level `col TYPE REFERENCES other(col)` | other table | `extends` |
| `ALTER TABLE foo ADD CONSTRAINT … FOREIGN KEY … REFERENCES bar` (the `pg_dump` / `mysqldump` style) | other table | `extends` |
| `FROM other_table` / `JOIN other_table` (in view / function / procedure body) | other table | `references` |
| `CALL` / `EXEC` / `EXECUTE other_proc` (in function / procedure body) | other proc | `calls` |
| `CREATE INDEX … ON other_table` | other table | `references` |
| `CREATE TRIGGER … ON other_table` | other table | `references` |

## Extensions

`.sql`, `.ddl`, `.dml`, `.psql`, `.pgsql`, `.tsql`

## Configuration

In `reponova.yml`:

```yaml
plugins:
  sql:
    enabled: true       # default: true
    # patterns: []      # override global patterns for SQL files
    # exclude: []       # override global exclude for SQL files
```

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Enable / disable SQL file detection and extraction |
| `patterns` | string[] | `[]` | Glob patterns to override global file matching for this plugin |
| `exclude` | string[] | `[]` | Glob patterns to override global exclusions for this plugin |

## Dialect handling

- **Identifier quoting**: `"double"`, `` `back` ``, `[bracket]`, bare. Three-part qualified names (`db.schema.name`) collapse to `schema.name` (the database segment is dropped — RepoNova works inside a single connection).
- **Comments**: `-- line`, `# line` (MySQL, only when anchored at the start of a line), `/* block */`.
- **Strings**: single quotes with `''` escape and PostgreSQL `E'…'` style escapes. String bodies are neutralised so tokens like `FROM`/`JOIN` inside data strings don't produce false-positive edges.
- **PostgreSQL dollar-quoted strings**: `$$ … $$` and `$tag$ … $tag$`. Bodies are neutralised — function-body symbols are NOT extracted today.
- **MySQL `DELIMITER`**: `DELIMITER ;;`, `DELIMITER //`, `DELIMITER $$` are tracked across the file. Statements end at the active delimiter, NOT at every `;`. `DELIMITER $$` in a MySQL file disables PG dollar-quote handling for `$$` (the two notations are mutually exclusive in practice).
- **T-SQL `BEGIN … END`**: nested `BEGIN`/`END` blocks are tracked so internal `;` characters inside procedure bodies don't terminate the outer `CREATE PROCEDURE`. `END IF`, `END LOOP`, `END WHILE`, `END CASE`, `END REPEAT` close their respective control-flow constructs without affecting the `BEGIN` depth counter.
- **`CREATE` modifier clauses**: `OR REPLACE`, `OR ALTER`, `DEFINER = user@host` (with any quoting), `SQL SECURITY DEFINER|INVOKER`, `ALGORITHM = UNDEFINED|MERGE|TEMPTABLE` are all accepted between `CREATE` and the object keyword (in any order).

## Resolution semantics

- **No imports**: SQL has no module / `import` semantics. `resolveImportPath` always returns `[]`. Schema-qualified references are graph edges, not imports.
- **Out of scope (intentionally)**:
  - Query-body symbol extraction (CTE names, subquery aliases) — these are scoped to a single statement and not stable identifiers.
  - `CREATE AGGREGATE`, `CREATE OPERATOR`, `CREATE RULE`, `CREATE EVENT`, `CREATE EXTENSION` — niche PostgreSQL/MySQL features outside the schema-level surface the graph layer consumes.
  - PL/pgSQL function-body call graphs — body content is neutralised by the dollar-quote stripper.

## Why regex instead of `tree-sitter-sql`?

The roadmap originally proposed Archetype A with `DerekStride/tree-sitter-sql`. Investigation showed that **no pre-built `tree-sitter-sql.wasm` is published anywhere in the ecosystem** (not by upstream, not by `@vscode/tree-sitter-wasm`, not by `@cursorless/tree-sitter-wasms`). Adopting it would have required adding `emscripten` + `tree-sitter-cli` to the monorepo's CI matrix solely for one plugin — and the grammar also ships with a [known scanner bug](https://github.com/DerekStride/tree-sitter-sql/issues/268) requiring a local patch. Meanwhile the schema-level surface RepoNova actually consumes (CREATE TABLE / VIEW / FUNCTION / PROCEDURE / INDEX / TYPE / SEQUENCE + FK & query refs) is well-bounded and regex-tractable across dialects, and a regex extractor gives multi-dialect tolerance for free instead of locking us to one grammar. See ROADMAP §6.1 for details.

## License

MIT — see [LICENSE](./LICENSE).
