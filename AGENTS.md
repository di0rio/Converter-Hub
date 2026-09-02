# SQL Database Extractor — Project Instructions

## What This Project Does

A database dump extraction tool. Parse MySQL, MariaDB and PostgreSQL dumps, select databases or schemas and tables, extract specific data, and generate new dumps.

**User workflow:**
1. Select SQL file
2. Select database
3. Select tables
4. Extract
5. Download

## Architecture

```
sql-database-extractor/
  apps/
    web/          — Next.js web interface
    cli/          — CLI tool
  packages/
    core/         — Shared core library
  examples/       — Sample SQL files
  docs/           — Documentation
```

**Package boundaries:**
- `packages/core/` — SQL parsing, extraction logic, domain types. No I/O, no UI.
- `apps/cli/` — CLI interface. Imports from core. No UI code.
- `apps/web/` — Next.js web interface. Imports from core. No CLI code.
- No cross-imports between CLI and Web.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Web:** Next.js 16+ (App Router), React 19, Tailwind CSS 4
- **UI Components:** COSS UI (Base UI + Tailwind)
- **Icons:** Lucide React
- **Build:** Bun
- **Source formats:** MySQL, MariaDB and PostgreSQL only. Dialect-specific SQL belongs under `packages/core/src/parser/<format>/`; nothing above the `FormatParser` interface may branch on format.

**Explicitly out of scope:** PostgreSQL, SQLite, generic SQL abstractions, Redux, MUI, server-side database connections.

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

The user workflow is: Select → Select → Extract → Download. Nothing more.

## Privacy and Security

SQL dumps may contain sensitive data. Rules:
- Never use real production dumps as fixtures — synthetic data only
- Never log SQL contents, INSERT values, passwords, tokens, API keys, or personal data
- Process everything locally — no external APIs, no cloud storage
- Do not add analytics, telemetry, or persistent upload storage
- Do not commit `.env`, credentials, production dumps, or private datasets
- Synthetic public SQL fixtures are allowed

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
