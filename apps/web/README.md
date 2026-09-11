# Converter Hub — Web Interface

The Next.js app that hosts the hub and its tools. Everything runs in the
browser: no file is uploaded, there is no server behind the processing, and no
SQL from your files is ever executed.

## Routes

| Route | What it is |
|-------|------------|
| `/` | The hub — pick a tool |
| `/spreadsheet` | Split a multi-sheet workbook into one file per sheet |
| `/sql` | Extract tables out of a SQL dump, a SQLite database or a Firebird 2.x database |
| `/data` | Convert one structured data file (CSV, TSV, JSON, JSON Lines, YAML, XML) to another format |
| `/markdown` | Turn a Markdown document into an HTML file, or an HTML page into Markdown |
| `/json-to-typescript` | Generate TypeScript types from a JSON sample |
| `/image` | Convert an SVG, PNG, JPEG, WebP or AVIF image to PNG, JPEG or WebP |

Every route is statically prerendered, so the app can be served as plain files.
Links do not prefetch (`prefetch={false}`): a tool's code loads when it is
opened, not when its card scrolls into view.

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
a database, for a dump → pick tables → choose SQL, CSV, XLSX, JSON, JSON Lines
or Markdown →
convert → download a ZIP. `components/sql-tool.tsx` reads the first bytes of
the pick: a SQLite header or a `-wal`/`-shm` companion goes to the SQLite reader
(a real SQLite build in WebAssembly, read-only), anything else to the dump
parser in `@sql-extractor/core`, which reads it with `file.text()`. A Firebird
2.x database (`.fdb`, `.gdb`) is recognised by its header too and takes the
database flow, read by `readFdbDatabase` in the core instead of a SQLite engine.

**Data:** choose a CSV, TSV, JSON, JSON Lines, YAML or XML file (XML read with
`DOMParser` in `lib/xml.ts`) → choose CSV (with
its delimiter), TSV, JSON, JSON Lines, YAML, Markdown, SQL or XLSX → convert →
download one file. `lib/data-convert.ts` reads the file into a plain value and
writes the output from it; the table outputs go through `recordsToTable` in
the core, which refuses a nested document. `lib/formats.ts` holds the format
metadata the tool and its hub card share. Single files download through
`downloadFile` in `lib/download.ts`, the same helper the ZIP download uses.

**Markdown:** choose Markdown to HTML or HTML to Markdown → choose a file of
that kind → convert → download one file: Markdown becomes a complete HTML
document, HTML becomes Markdown.
`lib/markdown.ts` uses `marked` (imported on demand) one way and `DOMParser`
the other. Nothing is rendered in the page; the output is only a download.

**JSON to TypeScript:** paste a JSON sample or open a `.json` file → the types
update as you type → copy them or download a `.ts` file. The page is `components/text-tool.tsx`,
which takes one spec per text tool over the functions in `@sql-extractor/core`.

**Parked:** Encoding, Case, Timestamps and Colors are built but off the hub.
Their pages are in `app/_parked`, which is not routed; see
`app/_parked/README.md` to bring one back.

**Images:** choose an SVG, PNG, JPEG, WebP or AVIF file → choose PNG, JPEG or
WebP → convert → download one file. `lib/image.ts` decodes it with an `Image`
from a Blob URL, draws it on a canvas and encodes it with `canvas.toBlob`. An
SVG must parse as SVG in `DOMParser` first, and is never inserted into the page.

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
