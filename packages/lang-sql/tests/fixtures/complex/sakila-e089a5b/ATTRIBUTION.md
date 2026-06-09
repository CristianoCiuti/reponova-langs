# Complex-tier fixture: jOOQ/sakila snapshot

This directory contains an unmodified, SHA-pinned snapshot of two
schema-definition files from the [`jOOQ/sakila`](https://github.com/jOOQ/sakila)
repository. It is the **complex tier** of `@reponova/lang-sql`'s test corpus
and is used to assert real-world parsing invariants per the RepoNova
language-plugin roadmap §5.4.

## Provenance

| | |
| --- | --- |
| **Upstream**     | <https://github.com/jOOQ/sakila> |
| **Commit**       | `e089a5b1ec9af0df7a9c6a5d47d49fa1736a4e84` |
| **Date**         | 2026-04-20 |
| **License**      | BSD 2-Clause (see `LICENSE`) |
| **Original work**| Sakila Sample Database by MySQL AB / Oracle Corporation |
| **Maintainer**   | Lukas Eder & contributors (jOOQ Object Oriented Querying) |

## Files

| File | Source path (upstream) | Lines | Description |
| --- | --- | --- | --- |
| `postgres-sakila-schema.sql` | `postgres-sakila-db/postgres-sakila-schema.sql` | 1711 | Pure PostgreSQL DDL — tables, sequences, ENUM types, domains, views, functions, triggers, indexes, and `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` constraint definitions emitted in `pg_dump` format. |
| `mysql-sakila-schema.sql` | `mysql-sakila-db/mysql-sakila-schema.sql`     |  644 | MySQL 5.7+ DDL — `ENGINE=InnoDB` tables, backticked identifiers, `CREATE DEFINER=...` views, `DELIMITER ;;` triggers, and `DELIMITER //` / `DELIMITER $$` stored procedures and functions. |
| `LICENSE`                    | `LICENSE`                                     |   25 | jOOQ/sakila license terms (BSD 2-Clause). |

Total ≈ 2355 lines of pure DDL covering all 13 SQL construct families
`lang-sql` recognises plus the multi-dialect quirks we care about.

## Why Sakila?

The Sakila "DVD-rental" sample database is the canonical SQL test
fixture used by the wider database ecosystem (PostgreSQL, MySQL,
SQL Server, Oracle, SQLite, DB2, CockroachDB, YugabyteDB). It packs
into a few KB the full range of constructs a real-world schema would
have:

* 15 base tables with inter-FK cross-references
* 7 views (some materialised in PostgreSQL)
* PL/pgSQL functions + triggers
* MySQL stored procedures + functions (with `DELIMITER ;;` / `//` / `$$`)
* PostgreSQL ENUM types + DOMAINs + sequences
* Partitioned `payment_*` tables (PostgreSQL prong only)
* Cross-schema references (MySQL uses an explicit `CREATE SCHEMA sakila`)

This makes it an ideal stress-test for a regex-based, multi-dialect-
tolerant extractor — the assertions in
`tests/fixtures.test.ts > complex/ tier: jOOQ/sakila @ e089a5b snapshot`
check that landmark structures survive parsing without drift.

## Updating the snapshot

To bump the fixture to a newer upstream commit:

1. Pick a target commit SHA and date from <https://github.com/jOOQ/sakila/commits/main>.
2. Replace the two `.sql` files and `LICENSE` from
   `https://raw.githubusercontent.com/jOOQ/sakila/<sha>/{postgres,mysql}-sakila-db/`
   and `https://raw.githubusercontent.com/jOOQ/sakila/<sha>/LICENSE`.
3. Update the **Commit** / **Date** rows above.
4. Re-run `pnpm --filter @reponova/lang-sql test` and adjust the floor
   counts in `tests/fixtures.test.ts > aggregate counts ...` if upstream
   added new objects (floors should only ever rise).

The bump should land in a single commit with the message
`chore(lang-sql): bump complex fixture to jOOQ/sakila@<short-sha>`.
