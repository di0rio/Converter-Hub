# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **The product is now Converter Hub.** The SQL extractor is no longer the whole
  app: it is one tool of two, reached from a hub at `/` that asks which tool you
  want before anything else. It moved to `/sql`; the spreadsheet splitter joins
  it at `/spreadsheet`. `apps/web/lib/tools.ts` is the single source of truth for
  the tool list and feeds the cards, titles, breadcrumbs and route metadata.
- Both tools now scroll the document on narrow screens instead of pinning the
  viewport height, which had squeezed the whole stacked flow into one screen it
  could not fit
- The spreadsheet tool counts data rows rather than range rows, so "5 rows"
  means the same thing it means on the SQL side and matches the numbered rows
  the preview shows

### Added

- **More spreadsheet inputs:** `.xlsb`, `.ods`, `.csv` and `.tsv`, each checked
  by a round trip through SheetJS. CSV and TSV are read as UTF-8 text into one
  sheet named after the file, with values kept as text, and a binary file or
  an unclosed quote is refused. A ZIP-based file that is not a ZIP is refused
  too. Every refusal uses the same neutral message.
- **JSON and Markdown outputs in the spreadsheet tool:** one `.json` array of
  row objects, or one GitHub-flavoured Markdown table, per sheet. Empty and
  repeated headers are named by `normalizeColumns` in `packages/core`, which
  the SQL writer will share; the CSV formula prefix is now `neutralizeFormula`
  there too, reused by the Markdown writer.
- **CSV delimiter choice in the spreadsheet tool:** comma (default), semicolon
  or tab, picked in the format step. `toCsv` in `packages/core` takes an
  optional `{ delimiter }`; its default output is unchanged byte for byte, so
  the SQL tool's CSV is exactly what it was.
- **Spreadsheet tool:** split a multi-sheet `.xlsx`, `.xlsm` or `.xls` workbook
  into one file per sheet — XLSX or CSV — packaged as a ZIP. Sheets with no
  content are listed but cannot be exported, sheet names are sanitised before
  they name an archive entry, and the split reports real per-sheet progress.
- A file dropzone shared by both tools, giving the SQL tool drag-and-drop it did
  not have, with the file picker still reachable from the keyboard
- A virtualised data grid shared by both previews, so a large sheet costs no
  more to paint than a large table
- `examples/spreadsheet/sample.xlsx`, a synthetic four-sheet workbook

### Fixed

- A split sheet whose formulas read another sheet (`=Summary!B2`), another
  workbook or a defined name opened with `#REF!` or `#NAME?`, because the file
  it was written to holds only that sheet. Those formulas are now written as
  the value Excel cached for them; formulas that read only their own sheet stay
  formulas, and the loaded workbook is never modified.
- The Preview control on a table or sheet row was revealed on hover only, so on
  a touch screen — which has no hover — there was no way to open a preview at
  all. It is now always visible below the desktop breakpoint.
- Splitting a workbook whose sheet name contains `:` `\` `/` `?` `*` `[` or `]`
  threw and failed the whole export; the tab name is now sanitised for the file
  being written, while the file name keeps the original

### Security

- The spreadsheet tool refuses workbooks over 100 MB up front, by size, before
  reading — a workbook inflates well past its size on disk once every cell is an
  object
- Spreadsheet CSV output goes through the same writer the SQL tool uses, so a
  cell starting with `=`, `+`, `-` or `@` is neutralised rather than read back
  as a formula
- SheetJS is installed from the vendor's own CDN, which is the route their
  documentation prescribes. The copy on the public npm registry stops at 0.18.5
  and carries known prototype-pollution and ReDoS advisories — which matters
  here, because the file being parsed is untrusted by definition.

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
