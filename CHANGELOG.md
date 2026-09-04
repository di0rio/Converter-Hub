# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- SQLite dump support (`sqlite3 .dump`): one database named `main`, PRAGMA and
  transaction statements kept out of the table list, compound trigger bodies
  held together
- Microsoft SQL Server support: `GO` batches, `[bracketed]` identifiers with
  `]]` escapes, `N'...'` literals, `SET IDENTITY_INSERT` blocks, schemas with
  the owning database from `USE [x]`
- Firebird support, including `SET TERM` bodies for triggers and procedures
- TiDB, YugabyteDB, Greenplum, Amazon Redshift, TimescaleDB and Citus as source
  formats in their own right: they share their parent's reader but keep their
  own identity, so a Greenplum dump is never relabelled PostgreSQL
- CockroachDB as an experimental format, with its one known gap recorded in the
  catalog rather than hidden
- A format catalog carrying a support status per engine, so the UI, the CLI and
  the README all derive their list from one place and cannot drift from what is
  actually implemented. Products with no local SQL dump (Snowflake, BigQuery,
  Databricks, Trino, Presto, Hive, Impala) are recorded with the reason
- A dialect model describing what differs between engines when splitting a
  script — terminator, batch separator, comment styles, string prefixes,
  identifier quoting including T-SQL brackets — so a new format supplies a
  dialect rather than another hand-written splitter
- A source format override in the web app, for the cases detection is
  deliberately unwilling to guess at
- A matrix test driving every readable format through detection, parsing and
  all three export formats

- PostgreSQL dump support: schemas, `COPY ... FROM stdin` blocks, `--inserts`
  output, dollar quoting, `E'...'` strings and psql meta-commands
- Source format detection, deliberately conservative: contradictory evidence
  names no format, and SQL with no engine markers is reported as assumed rather
  than detected
- `--format` on the CLI, and `parseDump(sql, { format })` in the core, to read a
  file as a named engine instead of detecting it
- Core SQL parsers for MySQL, MariaDB and PostgreSQL dump files
- Database detection and enumeration
- Table detection and enumeration within databases
- Extraction of all tables from a database
- Extraction of selected tables from a database
- SQL generation for extracted content (CREATE DATABASE, CREATE TABLE, INSERT statements, LOCK/UNLOCK tables)
- CLI with interactive mode (prompts for database and table selection)
- CLI with non-interactive mode (flags for database, tables, output)
- Web interface with file upload, database selection, table selection, and download
- Synthetic sample dumps, one per supported source format
  (`examples/<format>/sample.sql`)
- Monorepo structure with `packages/core`, `apps/cli`, `apps/web`
- TypeScript strict mode across all packages
- Vitest test suite for core and CLI packages, including a cross-format suite
  that runs the same extraction and export assertions over every source format

### Changed

- The core is no longer built around mysqldump. Dialect-specific SQL lives
  behind a `FormatParser` interface under `packages/core/src/parser/<format>/`;
  the extractor, the tabular reader and the export generators work on the
  normalised model alone
- The normalised model drops its MySQL-only fields. `Table.insertStatements`
  becomes `dataStatements`, and the LOCK/UNLOCK pair becomes
  `preDataStatements` and `postDataStatements`
- `parseSqlDump(sql)` becomes `parseDump(sql, options?)`, which detects the
  source engine and refuses a file it cannot place
- The web app names the engine a dump was read as, and uses that engine's word
  for a grouping of tables — schemas for PostgreSQL, databases for MySQL and
  MariaDB — instead of always saying "database"
