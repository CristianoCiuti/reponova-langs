---
"@reponova/lang-sql": minor
---

Add SQL language support (`.sql`, `.ddl`, `.dml`, `.psql`, `.pgsql`, `.tsql`)
with multi-dialect tolerance for PostgreSQL, MySQL, SQLite, T-SQL (SQL Server),
and BigQuery / Snowflake. The extractor focuses on the schema-level DDL
surface RepoNova's knowledge graph consumes:

- **Symbols**: tables (incl. `TEMP` / `UNLOGGED` / `FOREIGN` / `VIRTUAL`),
  views (incl. `MATERIALIZED`), functions, procedures, triggers, indexes
  (incl. `UNIQUE` / `CLUSTERED` / `NONCLUSTERED` / `BITMAP` / `FULLTEXT` /
  `SPATIAL`), types (incl. `AS ENUM`), domains, sequences, and schemas.
- **References**: `FOREIGN KEY ... REFERENCES` and inline column-level
  `REFERENCES` produce `extends` edges. `pg_dump` / `mysqldump`-style
  `ALTER TABLE foo ADD CONSTRAINT ... FOREIGN KEY ... REFERENCES bar` is
  also recognised. `FROM` / `JOIN` inside view, function, and procedure
  bodies produce `references` edges. `CALL` / `EXEC` / `EXECUTE` inside
  procedure bodies produce `calls` edges.

The extractor is regex-based (Archetype B) and ships no tree-sitter grammar.
The original ROADMAP proposed `tree-sitter-sql` (community), but no
pre-built `tree-sitter-sql.wasm` is published anywhere in the ecosystem
and the upstream grammar carries a known scanner bug requiring a local
patch — see the package README for the full rationale and ROADMAP §6.1 for
the updated plan. The pivot keeps the multi-dialect tolerance promise of
the Priority pack: regex naturally tolerates dialect quirks (backticks,
`[brackets]`, `AUTO_INCREMENT`, `IDENTITY`, `DEFINER=user`, `OR ALTER`,
`DELIMITER ;;`/`//`/`$$`, PostgreSQL dollar-quoted strings) where a
single grammar would lock us to one dialect.

The complex test tier is a SHA-pinned snapshot of `jOOQ/sakila` at commit
`e089a5b1ec9af0df7a9c6a5d47d49fa1736a4e84` (BSD 2-Clause) covering both
the PostgreSQL and MySQL prongs of the canonical Sakila DDL — 2355 LOC,
~115 schema symbols, ~170 cross-references across the two files. The
plugin stays well under the 50 KB size budget (~23.6 KB raw) and ships
with 82 tests at 98.34% statement / 87.3% branch / 100% function coverage.

Resolution semantics: SQL has no `import` semantics, so `resolveImportPath`
is a hard no-op.
