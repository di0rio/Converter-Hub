# SQL Database Extractor

A database dump extraction tool. Read a MySQL, MariaDB or PostgreSQL dump, select the tables you want, and export them as SQL, CSV or Excel — packaged as a ZIP you download from your browser.

## Why

Database dumps are often large, monolithic exports containing many databases and tables. This tool lets you pick exactly what you need and produce a clean, smaller export — as SQL, CSV or Excel — without installing a database server or uploading your data anywhere.

## Supported Formats

### Source formats

| Format | How rows are read | Grouping |
|--------|-------------------|----------|
| MySQL | `INSERT` statements | database |
| MariaDB | `INSERT` statements | database |
| PostgreSQL | `COPY ... FROM stdin` blocks and `INSERT` statements | schema |

Nothing else is supported. SQLite, SQL Server, Oracle and other dialects are
rejected rather than parsed on a best-effort basis.

### Export formats

| Format | Output |
|--------|--------|
| SQL | One `.sql` file, in the dialect the dump came from |
| CSV | One `.csv` per table, UTF-8 with a byte order mark |
| XLSX | One workbook, one sheet per table |

Source format and export format are independent: any supported dump can be
exported to any of the three. CSV and XLSX are engine-neutral, because they are
written from the normalised rows rather than from SQL.

### Format detection

The source engine is detected from markers the dump's own tool writes — version
comments, `LOCK TABLES`, `COPY ... FROM stdin`, `SET search_path`, and so on.
Detection is deliberately conservative:

- Markers from two engines at once produce no answer rather than a guess.
- SQL carrying no engine markers at all — a hand-written `CREATE TABLE` plus
  `INSERT`s — is read as MySQL, and the app says it assumed rather than
  detected the format.
- A file with nothing recognisable in it is refused as *Unsupported database
  format*.

The CLI's `--format` overrides detection. The core's `parseDump(sql, { format })`
does the same.

### Databases and schemas

MySQL and MariaDB group tables by database. PostgreSQL groups them by schema
inside a database. The tool does not pretend these are the same thing: it uses
the source engine's own word in the UI and in the CLI, and when a PostgreSQL
dump names the owning database, that name is kept alongside the schema rather
than discarded.

### Known limitations

- **SQL export preserves the source dialect; it does not convert between
  dialects.** A PostgreSQL dump exports to PostgreSQL SQL. There is no
  translation layer, and none is claimed.
- **Foreign keys can outlive their targets.** Exporting a subset of tables keeps
  each table's own constraints, which may reference tables you did not select.
- **Stored routines, views, triggers and grants are not extracted.** They are
  preserved in the dump's trailing statements where they appear there, but they
  are not offered as selectable objects.
- **PostgreSQL binary and custom-format dumps are not supported.** Only the
  plain-text output of `pg_dump` and `pg_dumpall` can be read.
- **SQLite is not supported.** A `.dump` file has no database or schema to
  select, so it would need a different selection model rather than a different
  parser; inventing a database name for it would be misleading. Implementing it
  is possible but has not been done.

## Privacy Model

- **Web app:** All SQL parsing and extraction happens entirely in your browser using client-side JavaScript (`file.text()`). Nothing is uploaded to a server. No network requests are made for data processing.
- **CLI:** Processes files locally on your machine.
- **No analytics, telemetry, or external APIs.**
- **No persistent storage** of SQL dump contents.

This project processes untrusted SQL input (your dump files). While every reasonable effort is made to handle input safely, no absolute security guarantees are made. See [SECURITY.md](./SECURITY.md) for details and vulnerability reporting.

## Limitations

- **Three engines only.** See [Supported Formats](#supported-formats). Anything else is refused rather than half-parsed.
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
# Interactive mode (prompts for the database or schema, then the tables)
node apps/cli/dist/index.js dump.sql
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
    mysql/sample.sql        Synthetic sample dumps, one per
    mariadb/sample.sql      supported source format
    postgresql/sample.sql
```

Inside the core:

```
packages/core/src/
  formats/       Which engines exist, what they call things, how to detect them
  parser/
    shared/      Lexical helpers and the FormatParser interface
    mysql/       MySQL and MariaDB (one dialect, two labels)
    postgresql/
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
| Source formats | MySQL, MariaDB, PostgreSQL |

**Explicitly out of scope:** SQLite and other dialects, dialect conversion, generic SQL abstractions, Redux, MUI, server-side database connections.

## Sample Data

The `examples/` directory holds one synthetic dump per supported source format. Every name, address and value in them is invented. They are safe to use in examples and tests — they contain no real personal or production data, and no credentials.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
