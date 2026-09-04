# SQL Database Extractor

A database dump extraction tool. Read a SQL dump from any of a dozen supported engines, select the tables you want, and export them as SQL, CSV or Excel — packaged as a ZIP you download from your browser.

## Why

Database dumps are often large, monolithic exports containing many databases and tables. This tool lets you pick exactly what you need and produce a clean, smaller export — as SQL, CSV or Excel — without installing a database server or uploading your data anywhere.

## Supported Formats

`packages/core/src/formats/catalog.ts` is the single source of truth for this
table. Every format there carries a status, and only `supported` is advertised
here, in the web UI and in the CLI. A format reaches `supported` only once it
has a parser, a synthetic fixture and passing tests, and a matrix test drives
every one of them through detection, parsing and all three exports on each run.

### Source formats

| Format | Reads | Grouping | Notes |
|--------|-------|----------|-------|
| MySQL | `INSERT` | database | |
| MariaDB | `INSERT` | database | |
| TiDB | `INSERT` | database | Dumpling output; `/*T![...] */` comments preserved |
| PostgreSQL | `COPY ... FROM stdin`, `INSERT` | schema | |
| YugabyteDB | `COPY`, `INSERT` | schema | `ysql_dump` output |
| Greenplum | `COPY`, `INSERT` | schema | `DISTRIBUTED BY` clauses preserved |
| Amazon Redshift | `INSERT` | schema | DDL plus INSERTs; see the note below |
| TimescaleDB | `COPY`, `INSERT` | schema | `create_hypertable()` preserved |
| Citus | `COPY`, `INSERT` | schema | distribution calls preserved |
| Microsoft SQL Server | `INSERT` | schema | `GO` batches, `[bracketed]` identifiers |
| SQLite | `INSERT` | database | `sqlite3 .dump` output |
| Firebird | `INSERT` | schema | `SET TERM` bodies handled |

**Experimental — readable, not advertised in the app:**

| Format | Gap |
|--------|-----|
| CockroachDB | A column family written with an unquoted name (`FAMILY fam_0 (id)`) cannot be told apart from a column named `family`, so it stays in the column list and shows up as an extra empty column. The quoted form `cockroach dump` normally writes is handled. |

**Recognised but not readable yet:** Azure Synapse Analytics, DuckDB, Oracle
Database, IBM Db2. A dump from one of these is *identified* — the app says which
engine it is and that it is not supported yet — rather than being refused as
unrecognisable or half-parsed.

**Not applicable.** These have no local SQL dump this tool could read, so they
are recorded with the reason rather than left to look like an oversight:

| Product | Why |
|---------|-----|
| Snowflake | Unloads to CSV/Parquet in cloud storage via `COPY INTO`. No local SQL dump of table data. |
| Google BigQuery | Exports to Cloud Storage as CSV, JSON or Avro. DDL is retrievable; rows never take the form of a SQL script. |
| Databricks SQL | Backed by Delta Lake files. Table data exports as Parquet or CSV, not as `INSERT` statements. |
| Trino, Presto | Query engines over other stores. They own no data and have no dump format of their own. |
| Apache Hive | Metadata lives in the metastore, rows live as files on HDFS or S3. Neither is a SQL dump. |
| Apache Impala | A query engine over Hive-managed storage. Rows are files, not `INSERT` statements. |

Non-SQL databases (MongoDB, Redis, Cassandra, DynamoDB, Elasticsearch, Neo4j)
are out of scope by design, not pending. Importing them would be a different
architecture, not another parser.

### Export formats

| Format | Output |
|--------|--------|
| SQL | One `.sql` file, in the dialect the dump came from |
| CSV | One `.csv` per table, UTF-8 with a byte order mark |
| XLSX | One workbook, one sheet per table |

Source format and export format are independent: any readable dump can be
exported to any of the three. CSV and XLSX are engine-neutral, because they are
written from the normalised rows rather than from SQL.

### Format detection

Detection resolves a *family* from markers the whole family shares, then the
*member* within it from markers only that product writes. That is what lets
Greenplum and PostgreSQL stay distinguishable without duplicating a parser, and
what stops a CockroachDB dump being relabelled PostgreSQL. A product's own
markers also count towards its family, since some — Redshift DDL, for one —
never write a family-wide banner at all.

Detection stays deliberately conservative:

- Markers from two families that are not clearly apart produce no answer rather
  than a guess.
- SQL carrying no engine markers at all — a hand-written `CREATE TABLE` plus
  `INSERT`s — is read as MySQL, and the app says it *assumed* rather than
  *detected* the format.
- A file with nothing recognisable in it is refused as *Unsupported database
  format*.

Detection can be overruled: the web app has a **Read as** control listing every
supported format, and the CLI takes `--format`. The core's
`parseDump(sql, { format })` does the same. An explicit choice is reported as a
choice, never as a detection.

### Databases and schemas

Engines disagree about what a grouping of tables is called, and the tool uses
each engine's own word rather than flattening them. MySQL, MariaDB and TiDB
group by database. The PostgreSQL family and SQL Server group by schema, and
when a dump names the owning database that name is kept alongside the schema.
SQLite has exactly one database and calls it `main` — that is SQLite's own name,
not one invented here, so it is offered as an ordinary selection.

### Known limitations

- **SQL export preserves the source dialect; it does not convert between
  dialects.** A PostgreSQL dump exports to PostgreSQL SQL. There is no
  translation layer, and none is claimed.
- **Foreign keys can outlive their targets.** Exporting a subset of tables keeps
  each table's own constraints, which may reference tables you did not select.
- **Stored routines, views, triggers and grants are not extracted.** They are
  preserved where the dump puts them, but are not offered as selectable objects.
- **SQL Server:** statements stacked in one `GO` batch are separated by keyword,
  which covers what SSMS writes. Procedure bodies are not parsed.
- **Redshift:** Redshift moves table data through `UNLOAD`/`COPY FROM s3://`,
  which is not a local SQL dump. What is supported is DDL plus `INSERT`
  statements — the closest thing to a portable local export.
- **Binary and custom-format dumps are not supported** for any engine. Only
  plain-text SQL is read.
- **Binary column values are kept as written** (`X'...'`, `0x...`) rather than
  decoded, so no byte is invented on the way to a spreadsheet.

## Privacy Model

- **Web app:** All SQL parsing and extraction happens entirely in your browser using client-side JavaScript (`file.text()`). Nothing is uploaded to a server. No network requests are made for data processing.
- **CLI:** Processes files locally on your machine.
- **No analytics, telemetry, or external APIs.**
- **No persistent storage** of SQL dump contents.

This project processes untrusted SQL input (your dump files). While every reasonable effort is made to handle input safely, no absolute security guarantees are made. See [SECURITY.md](./SECURITY.md) for details and vulnerability reporting.

## Limitations

- **Only the engines listed above.** See [Supported Formats](#supported-formats). Anything else is refused or named as unsupported, never half-parsed.
- **Pragmatic parsers.** Each parser handles the output its engine's dump tool writes; none is a universal SQL parser. Edge cases in highly unusual dump formats may not parse correctly.
- **Memory-bound.** Entire files are loaded into memory. Very large dumps (multi-gigabyte) may exhaust available memory depending on your environment.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (for development)

### Install

```bash
git clone <repo-url> sql-database-extractor
cd sql-database-extractor
bun install
```

`bun install` does not run any project lifecycle script — installing this
repository never executes its code. See [CONTRIBUTING.md](./CONTRIBUTING.md)
for the setup model and for how to review contributor branches safely.

### Web Interface

```bash
bun run dev:web
```

Open [http://localhost:3000](http://localhost:3000), upload a `.sql` file, select a database and tables, then download the extracted SQL.

### CLI

Build first (`bun run build`), then run the CLI from its build output:

```bash
# Extract all tables from a specific database
node apps/cli/dist/index.js dump.sql -d store_db -a -o output.sql
```

```bash
# Extract specific tables
node apps/cli/dist/index.js dump.sql -d store_db -t customers,orders -o output.sql
```

```bash
# A PostgreSQL dump: pick a schema rather than a database
node apps/cli/dist/index.js dump.sql -d public -a -o output.sql
```

```bash
# Read the file as a named engine instead of detecting it
node apps/cli/dist/index.js dump.sql -f postgresql -d public -a -o output.sql
```

```bash
# Interactive mode (prompts for the database or schema, then the tables, then the output path)
node apps/cli/dist/index.js dump.sql
```

```bash
# Fully interactive: omit the file too, and browse the filesystem to pick one
node apps/cli/dist/index.js
```

### Build All Packages

```bash
bun run build
```

## Development

### Project Structure

```
sql-database-extractor/
  packages/
    core/          SQL parsing, extraction logic, domain types
  apps/
    web/           Next.js web interface
    cli/           Command-line interface
  examples/
    <format>/sample.sql     One synthetic sample dump per readable
                            source format, named by its catalog id
```

Inside the core:

```
packages/core/src/
  formats/       The catalog: which engines exist, their support status,
                 what they call things, and how to detect them
  parser/
    shared/      The FormatParser interface, the dialect model, and the
                 dialect-driven script splitter and row readers
    mysql/       MySQL, MariaDB and TiDB (one reader, three identities)
    postgresql/  PostgreSQL and its derivatives
    sqlserver/
    sqlite/
    firebird/
  types/         The normalised dump model every other layer works on
  extractor/     Rebuilds SQL from the model
  tabular/       Turns the model into columns and rows
  generator/     CSV, XLSX and ZIP
```

Dialect-specific SQL lives only under `parser/<format>/`. Everything above it
works on the normalised model, so adding an engine means writing one
`FormatParser` and registering it — no changes to the extractor, the generators
or the UI.

- `packages/core` — No I/O, no UI. Pure parsing and extraction logic.
- `apps/cli` — CLI interface. Imports from core. No UI code.
- `apps/web` — Next.js web interface. Imports from core. No CLI code.

### Commands

| Command | Description |
|---------|-------------|
| `bun install` | Install all dependencies |
| `bun run build` | Build all packages |
| `bun run typecheck` | Type-check all packages |
| `bun run test` | Run all tests |
| `bun run lint` | Lint the web app |
| `bun run dev:web` | Start web dev server |
| `bun run dev:cli` | Start CLI in dev mode |

### Testing

```bash
# Run all tests
bun run test

# Run tests for a single package
bun run --filter @sql-extractor/core test
bun run --filter sql-extractor test

# Watch mode
bun run --filter @sql-extractor/core test:watch
```

### Quality Gates

Before considering any change complete:

1. `bun run typecheck` — passes
2. `bun run lint` — passes
3. `bun run test` — passes
4. `bun run build` — succeeds

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode) |
| Web | Next.js 16 (App Router), React 19 |
| UI | COSS UI (Base UI + Tailwind CSS 4) |
| Icons | Lucide React |
| Build | Bun |
| Tests | Vitest |
| Source formats | See [Supported Formats](#supported-formats) |

**Explicitly out of scope:** dialect conversion, non-SQL databases, generic SQL abstractions, Redux, MUI, server-side database connections.

## Sample Data

The `examples/` directory holds one synthetic dump per supported source format. Every name, address and value in them is invented. They are safe to use in examples and tests — they contain no real personal or production data, and no credentials.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
