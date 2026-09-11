# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **An Images tool at `/image`.** SVG, PNG, JPEG, WebP and AVIF in; PNG, JPEG
  and WebP out, as one file, with no library: `Image`, canvas, `toBlob`. An SVG
  is validated by content and loaded only through `<img>` from a Blob URL, so
  its scripts never run and its external resources are never fetched. AVIF is
  input only, where the browser decodes it.
- **JSON Lines from the SQL tool.** Dumps and SQLite databases export one
  `.jsonl` per table, one record per row, through the core's `toJsonl` and
  `tableToRecords`.
- **Five text tools: `/encoding`, `/case`, `/timestamp`, `/color` and
  `/json-to-typescript`.** Paste text, pick a mode, and the result updates as
  you type, ready to copy or download. Base64, hex, URL encoding and HTML
  entities both ways; seven identifier cases; Unix seconds, milliseconds and
  ISO 8601 in UTC, saying when an offset was assumed; HEX, rgb() and hsl(),
  refusing out-of-range values; TypeScript types from a JSON sample. The
  conversions live in `packages/core/src/utilities`.
- **A Markdown tool at `/markdown`.** A Markdown document becomes a complete
  HTML file (through `marked`, loaded on demand) and an HTML page becomes
  Markdown (through `DOMParser`). Nothing is rendered in the app. Raw HTML in
  Markdown is escaped, and addresses other than `http`, `https`, `mailto` and
  relative ones are dropped from links and images in both directions.
- **XML in the Data tool.** Read with `DOMParser` into a fixed, documented shape
  (`@attributes`, repeated elements as lists, `#text`), never resolving external
  entities. `recordsToTable` now steps through single-property wrappers to reach
  a list, so `<people><person>…` converts to a table.
- **A Data tool at `/data`.** One structured file in, one file out: CSV, TSV,
  JSON, JSON Lines and YAML in; CSV, TSV, JSON, JSON Lines, YAML, Markdown, SQL
  and XLSX out. A table output refuses a nested document instead of flattening
  it. YAML uses the `yaml` library, loaded only when needed.
- A CSV parser in `packages/core/src/csv` (RFC 4180 quoting, delimiter
  detection) and JSON / JSON Lines parsing with the table gate in
  `packages/core/src/records`. Errors name the problem, and for JSON Lines the
  line, never the content.
- Single-file downloads: `downloadFile` in `apps/web/lib/download.ts`, which
  `downloadZip` now calls, and `DownloadStep` names the button after the file's
  format.
- **SQLite databases in the SQL tool.** `/sql` now reads a SQLite database
  file directly — `.db`, `.sqlite`, `.sqlite3`, `.db3` or any other name,
  recognised by its header rather than its extension — as well as dumps, and
  converts the tables you pick. One picker takes both: the tool reads the file's
  first bytes and hands a database to the SQLite reader and anything else to the
  dump parser, switching when the next file is the other kind.
- Dumps export to JSON and Markdown too, through the same writers the
  spreadsheet and SQLite exports use, so both inputs offer SQL, CSV, XLSX, JSON
  and Markdown.
- **Write-ahead logs are read.** Select a `name-wal` alongside the database and
  the rows it holds are included, so a database whose recent writes have not been
  checkpointed converts to its latest committed state instead of silently losing
  them. A real SQLite build applies the log; nothing here parses WAL frames by
  hand. A `name-shm` is accepted and ignored, because it carries no data.
- The CLI gained `sqlite <files...>`: the database, optionally followed by its
  `-wal` and `-shm`. Without an explicit log it reads the one beside the
  database. Files are paired by path, so another database's log is refused.
- A `-wal` whose header checksum fails is refused rather than skipped, because
  SQLite would otherwise open the main file alone and lose the log's rows
  without a word.
- CSV exports from SQLite take the same delimiter choice as the spreadsheet
  tool, through one shared `CsvDelimiterField`.
- Values keep their SQLite storage class on the way out: NULL stays distinct from
  an empty string, 64-bit integers stay exact, text that looks numeric is not
  converted, and BLOBs become base64 in text formats and `X'hex'` in SQL. The SQL
  export carries the schema SQLite already stored, so keys and constraints
  survive.
- A database that fails its integrity check, or that is truncated, encrypted or
  not SQLite at all, is refused with a message that names no file contents —
  never partially exported.
- Generated columns are left out of every export. Reading `SELECT *` against
  the column list `table_info` reports had shifted every value after one such
  column into the wrong header.

### Fixed

- The web test script no longer breaks React on Windows without Developer
  Mode. `ensure-react-symlinks.mjs` links with a directory junction there, and
  builds the new link before removing the old one, so a failure can no longer
  leave `apps/web/node_modules/react` missing.

### Changed

- `toFileName`, `uniqueName` and `groupSqliteFiles` live in `packages/core`, so
  the spreadsheet tool, the SQLite tool and the CLI name files and pair
  companions the same way. Two SQLite tables whose names collide once cleaned,
  or differ only by case, no longer overwrite each other in the ZIP.
- `TableSelect` takes a list of tables by name rather than a parsed `Database`,
  so the SQL and SQLite tools share one picker without either adopting the
  other's model.
- `FileSelect` can accept a whole selection, for tools whose input is more than
  one file.
- The README no longer says "no SQL is ever executed" without qualification. No
  SQL from your files is executed — a dump is never replayed — but reading a
  SQLite database does mean a SQLite engine reads its tables, read-only, in your
  browser.

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
- **SQL output in the spreadsheet tool:** one `.sql` script per sheet — a
  `CREATE TABLE` of `TEXT` columns and `INSERT`s batched 500 rows at a time —
  so a spreadsheet can be loaded into a database without a schema being guessed
  from its cells. Values are escaped by doubling quotes, the only escape
  standard SQL defines, and the script opens with a MySQL-only mode line
  (`ANSI_QUOTES,NO_BACKSLASH_ESCAPES`) so that a cell ending in a backslash
  cannot escape its closing quote and be read as SQL there.
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
