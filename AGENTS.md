# Converter Hub - Project Instructions

## What This Project Does

A hub of local-first file converters. The user opens the hub, picks a tool, and
works entirely in their browser.

**Tools** (`apps/web/lib/tools.ts` is the single source of truth):

| Tool | Route | Reads | Writes |
|------|-------|-------|--------|
| Spreadsheets | `/spreadsheet` | XLSX, XLSM, XLS, XLSB, ODS, CSV, TSV | XLSX, CSV, JSON, Markdown, SQL |
| SQL | `/sql` | SQL dumps, SQLite databases with their `-wal`, Firebird 2.x databases | SQL, CSV, XLSX, JSON, JSON Lines, Markdown |
| Data | `/data` | CSV, TSV, JSON, JSON Lines, YAML, XML | CSV, TSV, JSON, JSON Lines, YAML, Markdown, SQL, XLSX |
| Markdown | `/markdown` | Markdown, HTML | HTML, Markdown |
| JSON to TypeScript | `/json-to-typescript` | JSON | TypeScript |
| Images | `/image` | SVG, PNG, JPEG, WebP, AVIF | PNG, JPEG, WebP |

The SQL tool's supported dump engines are whatever
`packages/core/src/formats/catalog.ts` marks `supported`. That catalog is
SQL-specific (families, markers, dialects) and stays so. General file formats
live in `apps/web/lib/formats.ts`: a label, extensions and a MIME type per
format, and the lists of what each general tool reads and writes. The Data
tool's hub card is derived from those lists, so it cannot advertise a format
the converter does not handle.

**Data workflow:** select a file → format (and, for CSV, the delimiter) →
convert → download one file.

**Markdown workflow:** choose the direction (Markdown to HTML or HTML to
Markdown) → select a file of that kind → convert → download one file. `apps/web/lib/markdown.ts` holds both
directions; it renders nothing in the app, escapes raw HTML in Markdown, and
keeps only `http`, `https`, `mailto` and relative addresses. Never add a
preview that injects the converted HTML into the page.

**Text tools workflow:** paste text, or open a file where the spec allows it →
pick a mode, where there is one → read, copy or download the result, converted
as you type. The text tools are one
component, `apps/web/components/text-tool.tsx`, driven by a table of specs; the
conversions are pure functions in `packages/core/src/utilities`. A new text
tool is a spec entry, a registry entry and a route. Errors shown are only
`DataFormatError` messages or a generic one.

Only JSON to TypeScript is on the hub. Encoding, Case, Timestamps and Colors are
parked: their registry entries are commented out at the end of `TOOLS`, and
their pages sit in `apps/web/app/_parked`, a private folder the router ignores.
`apps/web/app/_parked/README.md` says how to bring one back. Do not re-enable
one without being asked.

**Image workflow:** select an image → PNG, JPEG or WebP → convert → download
one file. `apps/web/lib/image.ts` decodes through `Image`, draws on a canvas
and encodes with `canvas.toBlob`. An SVG is validated by content with
`DOMParser` and loaded only through `<img>` from a Blob URL. Never inject an SVG
into the DOM and never advertise AVIF as an output.

Structured data flows `parser → value → writer`. Parsers and the table gate
(`recordsToTable`) are in `packages/core/src/csv` and `packages/core/src/records`;
YAML, which needs a dependency only the browser uses, is in
`apps/web/lib/data-convert.ts`. XML depends on `DOMParser`, so it is in
`apps/web/lib/xml.ts`. A table output refuses a nested document with
`DataFormatError` rather than inventing a flattening; the only unwrapping it
does is stepping through single-property objects to reach a list.

**Spreadsheet workflow:** select workbook → select sheets → format (and, for
CSV, the delimiter) → split → download.

**SQL workflow, dump:** select dump → select database → select tables → format
→ convert → download.

**SQL workflow, SQLite:** select the database (and its `-wal`/`-shm` if it has
them) → select tables → format (and, for CSV, the delimiter) → convert →
download.

One tool, two readers. `components/sql-tool.tsx` looks at what was picked - a
file starting with the SQLite header, or a `-wal`/`-shm` companion, is a
database; anything else is a dump - and renders `SqlExtractor` or
`SqliteConverter`. The two share the table picker, the preview grid, the format
options and the writers, and share no model: `SqlDump` belongs to the parser,
`SqliteDatabase` to the reader, and neither is expressed in terms of the other.
Keep the routing in `sql-tool.tsx`; neither flow should learn about the other.


Never list a tool in the registry before its route exists. The hub advertises
only what is implemented.

## Architecture

```
converter-hub/
  apps/
    web/          - Next.js web interface: the hub and both tools
    cli/          - CLI tool (SQL only)
  packages/
    core/         - Shared core library (SQL parsing, ZIP, CSV, XLSX)
  examples/       - Synthetic sample files
  docs/           - Documentation
```

**Package boundaries:**
- `packages/core/` - SQL parsing, extraction logic, domain types, and the ZIP,
  CSV and XLSX writers both tools share. No I/O, no UI.
- `apps/cli/` - CLI interface. Imports from core. No UI code.
- `apps/web/` - Next.js web interface. Imports from core. No CLI code.
- No cross-imports between CLI and Web.

**Where SQLite logic lives:** `packages/core/src/sqlite/`. The reader runs a real
SQLite compiled to WebAssembly (`wa-sqlite`) over an in-memory filesystem holding
the selected bytes, so SQLite itself applies the write-ahead log - there is no
hand-written WAL parser, and there must not be one: misreading a half-written
frame would produce corrupt rows that look real. Both apps use it, so a database
converts identically from the browser and the CLI.

The `-shm` file carries no data. It is a WAL index shared between processes, and
SQLite rebuilds it in heap memory under an exclusive lock, so the tool accepts it
and ignores it. Only the database and its `-wal` are ever read.

**Where spreadsheet logic lives:** `apps/web/lib/spreadsheet.ts`, not
`packages/core/`. It is UI-independent and unit-tested, but it is bound to
SheetJS and consumed only by the web app; hoisting it into core would drag
`xlsx` into the CLI's dependency graph for a tool the CLI does not have. If a
spreadsheet CLI ever appears, promoting it is a file move.

**What the two tools share** (`apps/web/`):
- `components/ui/` - the design system. Never duplicate a primitive.
- `components/file-dropzone.tsx` - the entry point of both flows.
- `components/data-grid.tsx` - the virtualised table both previews render.
- `components/format-options.tsx` - the output-format picker.
- `components/download-step.tsx` - run, report, download.
- `components/tool-header.tsx` - breadcrumb and heading.
- `lib/download.ts` - handing a ZIP to the browser.
- `createZip`, `toCsv`, `toSqlInserts`, `normalizeColumns` and `formatBytes`
  from `packages/core`.

Before writing a new component, check whether one of these already does it.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Web:** Next.js 16+ (App Router), React 19, Tailwind CSS 4
- **UI Components:** COSS UI (Base UI + Tailwind)
- **Icons:** Lucide React
- **Build:** Bun
- **Spreadsheets:** SheetJS, installed from the vendor CDN rather than the npm registry copy, which is stale and carries advisories that matter for untrusted input.
- **Source formats:** `packages/core/src/formats/catalog.ts` is the single source of truth. Every format carries a `status`, and only `supported` may be advertised in the UI, the CLI or the README - never hardcode a format list anywhere else. A format is promoted to `supported` only once it has a parser, a synthetic fixture and passing tests.

Dialect-specific SQL belongs under `packages/core/src/parser/<format>/`; nothing above the `FormatParser` interface may branch on format. Lexical differences between engines are described as data in `packages/core/src/parser/shared/dialect.ts`, so a new format supplies a dialect rather than a new splitter.

**Explicitly out of scope:** dialect conversion (a dump exports as the SQL it came from, never translated), non-SQL databases (MongoDB, Redis, Cassandra and the like), generic SQL abstractions, Redux, MUI, and server-side database connections. These tools read local files - a SQL script or a SQLite database file; they never connect to a database server.

**Out of scope for the SQLite tool specifically:** running SQL the user supplies, a query console, any write to the source database, migration to another engine, loading SQLite extensions, decrypting SQLCipher databases, and forensic recovery (carving, undelete, freelist or deleted-row recovery, repairing a corrupt database). A database that fails its integrity check is refused, never partially exported.

## Principles

- **KISS** - Simplest solution that works
- **YAGNI** - Don't build what you don't need yet
- **DRY** - Don't repeat yourself
- **Separation of concerns** - Each package has one job
- **Explicit boundaries** - Clear imports, no circular dependencies
- **Small modules** - Keep files focused
- **Simple APIs** - Minimal surface area
- **Testable code** - Every function should be testable

## Design Rules

The interface must remain extremely simple. The design must NEVER be used as a reason to:
- Add unnecessary features
- Add unnecessary animations
- Add dashboards
- Add decorative sections
- Add complex navigation
- Add excessive cards
- Add unnecessary gradients
- Add visual noise
- Add dependencies without justification

Each tool's workflow is: Select → Select → Convert → Download. Nothing more.
The hub is a list of tools, not a dashboard.

## Privacy and Security

Dumps and spreadsheets may both contain sensitive data. Rules:
- Never use real production dumps or real spreadsheets as fixtures - synthetic data only
- Never log SQL contents, INSERT values, cell values, passwords, tokens, API keys, or personal data
- Never show a caught error's message to the user - it can carry fragments of their file
- Process everything locally - no external APIs, no cloud storage
- Do not add analytics, telemetry, or persistent upload storage
- Do not commit `.env`, credentials, production dumps, or private datasets
- Synthetic public fixtures are allowed

## Quality Gates

Before any task is complete:
1. Type check passes
2. Lint passes
3. Tests pass
4. Build succeeds
5. No security regressions (for security-sensitive changes)

## Agents

This project uses specialized agents. Delegate to the right agent:

| Agent | Use For |
|-------|---------|
| orchestrator | Coordination, planning, task delegation |
| core-agent | SQL parsing, extraction logic, domain types |
| cli-agent | CLI commands, input/output, validation |
| web-agent | Next.js UI, upload, selection, download |
| integration-agent | Cross-package wiring, build config |
| security-agent | Security review, privacy validation |
| qa-agent | Tests, linting, type checking, quality |
| opensource-agent | Documentation, release preparation |
