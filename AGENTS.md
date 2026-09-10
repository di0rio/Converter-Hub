# Converter Hub — Project Instructions

## What This Project Does

A hub of local-first file converters. The user opens the hub, picks a tool, and
works entirely in their browser.

**Tools** (`apps/web/lib/tools.ts` is the single source of truth):

| Tool | Route | Reads | Writes |
|------|-------|-------|--------|
| Spreadsheets | `/spreadsheet` | XLSX, XLSM, XLS | XLSX, CSV |
| SQL | `/sql` | SQL dumps | SQL, CSV, XLSX |

The SQL tool's supported engines are whatever
`packages/core/src/formats/catalog.ts` marks `supported`.

**Spreadsheet workflow:** select workbook → select sheets → format → split →
download.

**SQL workflow:** select dump → select database → select tables → format →
convert → download.

Never list a tool in the registry before its route exists. The hub advertises
only what is implemented.

## Architecture

```
converter-hub/
  apps/
    web/          — Next.js web interface: the hub and both tools
    cli/          — CLI tool (SQL only)
  packages/
    core/         — Shared core library (SQL parsing, ZIP, CSV, XLSX)
  examples/       — Synthetic sample files
  docs/           — Documentation
```

**Package boundaries:**
- `packages/core/` — SQL parsing, extraction logic, domain types, and the ZIP,
  CSV and XLSX writers both tools share. No I/O, no UI.
- `apps/cli/` — CLI interface. Imports from core. No UI code.
- `apps/web/` — Next.js web interface. Imports from core. No CLI code.
- No cross-imports between CLI and Web.

**Where spreadsheet logic lives:** `apps/web/lib/spreadsheet.ts`, not
`packages/core/`. It is UI-independent and unit-tested, but it is bound to
SheetJS and consumed only by the web app; hoisting it into core would drag
`xlsx` into the CLI's dependency graph for a tool the CLI does not have. If a
spreadsheet CLI ever appears, promoting it is a file move.

**What the two tools share** (`apps/web/`):
- `components/ui/` — the design system. Never duplicate a primitive.
- `components/file-dropzone.tsx` — the entry point of both flows.
- `components/data-grid.tsx` — the virtualised table both previews render.
- `components/format-options.tsx` — the output-format picker.
- `components/download-step.tsx` — run, report, download.
- `components/tool-header.tsx` — breadcrumb and heading.
- `lib/download.ts` — handing a ZIP to the browser.
- `createZip`, `toCsv` and `formatBytes` from `packages/core`.

Before writing a new component, check whether one of these already does it.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Web:** Next.js 16+ (App Router), React 19, Tailwind CSS 4
- **UI Components:** COSS UI (Base UI + Tailwind)
- **Icons:** Lucide React
- **Build:** Bun
- **Spreadsheets:** SheetJS, installed from the vendor CDN rather than the npm registry copy, which is stale and carries advisories that matter for untrusted input.
- **Source formats:** `packages/core/src/formats/catalog.ts` is the single source of truth. Every format carries a `status`, and only `supported` may be advertised in the UI, the CLI or the README — never hardcode a format list anywhere else. A format is promoted to `supported` only once it has a parser, a synthetic fixture and passing tests.

Dialect-specific SQL belongs under `packages/core/src/parser/<format>/`; nothing above the `FormatParser` interface may branch on format. Lexical differences between engines are described as data in `packages/core/src/parser/shared/dialect.ts`, so a new format supplies a dialect rather than a new splitter.

**Explicitly out of scope:** dialect conversion (a dump exports as the SQL it came from, never translated), non-SQL databases (MongoDB, Redis, Cassandra and the like), generic SQL abstractions, Redux, MUI, and server-side database connections. This tool reads local SQL scripts; it never connects to a database.

## Principles

- **KISS** — Simplest solution that works
- **YAGNI** — Don't build what you don't need yet
- **DRY** — Don't repeat yourself
- **Separation of concerns** — Each package has one job
- **Explicit boundaries** — Clear imports, no circular dependencies
- **Small modules** — Keep files focused
- **Simple APIs** — Minimal surface area
- **Testable code** — Every function should be testable

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
- Never use real production dumps or real spreadsheets as fixtures — synthetic data only
- Never log SQL contents, INSERT values, cell values, passwords, tokens, API keys, or personal data
- Never show a caught error's message to the user — it can carry fragments of their file
- Process everything locally — no external APIs, no cloud storage
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
