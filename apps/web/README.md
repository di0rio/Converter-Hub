# Converter Hub — Web Interface

The Next.js app that hosts the hub and both of its tools. Everything runs in the
browser: no file is uploaded, there is no server behind the processing, and no
SQL is ever executed.

## Routes

| Route | What it is |
|-------|------------|
| `/` | The hub — pick a tool |
| `/spreadsheet` | Split a multi-sheet workbook into one file per sheet |
| `/sql` | Extract databases and tables out of a SQL dump |

Every route is statically prerendered, so the app can be served as plain files.

`lib/tools.ts` is the single source of truth for the tool list. It feeds the hub
cards, the page titles, the breadcrumbs and the route metadata, so adding a
third tool is an entry there plus a route — the hub itself needs no changes.
Never add an entry for a tool whose route does not exist yet.

## Getting Started

```bash
# From the repository root
bun install
bun run dev:web
```

Open [http://localhost:3000](http://localhost:3000) and pick a tool.

## How It Works

**Spreadsheets:** choose a spreadsheet (`.xlsx`, `.xlsm`, `.xls`, `.xlsb`, `.ods`, `.csv`,
`.tsv`) → pick the sheets
→ choose XLSX, CSV (comma, semicolon or tab), JSON, Markdown or SQL → split
→ download a ZIP. The file is read with
`file.arrayBuffer()` (CSV and TSV with `file.text()`, as UTF-8) and parsed by
SheetJS in the tab.

**SQL:** choose a dump or a SQLite database (with its `-wal` and `-shm`) → pick
a database, for a dump → pick tables → choose SQL, CSV, XLSX, JSON or Markdown →
convert → download a ZIP. `components/sql-tool.tsx` reads the first bytes of
the pick: a SQLite header or a `-wal`/`-shm` companion goes to the SQLite reader
(a real SQLite build in WebAssembly, read-only), anything else to the dump
parser in `@sql-extractor/core`, which reads it with `file.text()`.

## Shared Code

The two tools are independent flows over a shared spine. Before adding a
component, check whether one of these already covers it:

| Module | Used for |
|--------|----------|
| `components/ui/` | The design system. Never duplicate a primitive. |
| `components/file-dropzone.tsx` | The entry point of both flows: drop target and file picker, with a keyboard path that is not drag-and-drop |
| `components/data-grid.tsx` | The virtualised table both previews render |
| `components/format-options.tsx` | The output-format picker |
| `components/download-step.tsx` | Run, report what was produced, download |
| `components/tool-header.tsx` | Breadcrumb back to the hub, plus the heading |
| `lib/download.ts` | Handing a ZIP to the browser as a `blob:` URL |
| `createZip`, `toCsv`, `toSqlInserts`, `formatBytes` from core | Archives, CSV, SQL inserts, byte counts |

Spreadsheet logic lives in `lib/spreadsheet.ts` rather than in `packages/core`:
it is UI-independent and unit-tested, but it is bound to SheetJS and used only
here, and hoisting it would drag `xlsx` into the CLI's dependency graph for a
tool the CLI does not have.

## Development

```bash
bun run dev          # Start Next.js dev server
bun run build        # Production build
bun run lint         # Lint
bun run typecheck    # Type check
bun run test         # Run tests
```

## Tech Stack

- Next.js 16 (App Router)
- React 19
- Tailwind CSS 4
- COSS UI (Base UI)
- SheetJS, from the vendor CDN rather than the stale npm registry copy
- TypeScript
