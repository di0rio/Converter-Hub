# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
