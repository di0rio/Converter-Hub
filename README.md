# SQL Database Extractor

A MySQL/MariaDB SQL dump extraction tool. Parse SQL dump files, select databases and tables, and export the result as SQL, CSV or Excel — packaged as a ZIP you download from your browser.

## Why

SQL dump files are often large, monolithic exports containing multiple databases and tables. This tool lets you pick exactly what you need and produce a clean, smaller export — as SQL, CSV or Excel — without installing a database server or uploading your data anywhere.

## Privacy Model

- **Web app:** All SQL parsing and extraction happens entirely in your browser using client-side JavaScript (`file.text()`). Nothing is uploaded to a server. No network requests are made for data processing.
- **CLI:** Processes files locally on your machine.
- **No analytics, telemetry, or external APIs.**
- **No persistent storage** of SQL dump contents.

This project processes untrusted SQL input (your dump files). While every reasonable effort is made to handle input safely, no absolute security guarantees are made. See [SECURITY.md](./SECURITY.md) for details and vulnerability reporting.

## Limitations

- **MySQL and MariaDB only.** PostgreSQL, SQLite, and other SQL dialects are not supported.
- **Pragmatic parser.** The parser handles common mysqldump output but is not a universal SQL parser. Edge cases in highly unusual dump formats may not parse correctly.
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

```bash
# Extract all tables from a specific database
bun run --filter sql-extractor dev -- dump.sql -d store_db -a -o output.sql

# Extract specific tables
bun run --filter sql-extractor dev -- dump.sql -d store_db -t customers,orders -o output.sql

# Interactive mode (prompts for database and table selection)
bun run --filter sql-extractor dev -- dump.sql
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
    sample-mysql-dump.sql   Synthetic sample dump
```

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
| SQL Support | MySQL and MariaDB only |

**Explicitly out of scope:** PostgreSQL, SQLite, generic SQL abstractions, Redux, MUI, server-side database connections.

## Sample Data

The `examples/` directory contains a synthetic SQL dump file with fictional data. This file is safe to use in examples and tests — it contains no real personal or production data.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
