---
name: architecture
description: "Use when designing or reviewing monorepo structure, package boundaries, module organization, dependency management, or build configuration. Covers TypeScript project references, workspace setup, and separation of concerns."
---

# Architecture Skill

## Project Structure

```
sql-database-extractor/
  apps/
    web/          - Next.js web interface
    cli/          - CLI tool
  packages/
    core/         - Shared core library
  examples/       - Sample SQL files
  docs/           - Documentation
  .opencode/      - OpenCode configuration
```

## Package Boundaries

### Core (`packages/core/`)
- SQL parsing logic
- Extraction logic
- SQL generation
- Domain types and interfaces
- No I/O side effects (no file system, no network)
- No UI code, no CLI code

### CLI (`apps/cli/`)
- Command-line interface
- File I/O operations
- User input handling
- Imports from `packages/core/`
- No UI code

### Web (`apps/web/`)
- Next.js web interface
- File upload handling (client-side)
- UI components
- Imports from `packages/core/`
- No CLI code

## Dependency Rules

- `apps/cli/` → `packages/core/` (one direction)
- `apps/web/` → `packages/core/` (one direction)
- `apps/cli/` ≠ `apps/web/` (no cross-imports)
- No circular dependencies
- No dependency on external services for core logic

## Monorepo Tools

- Use npm/bun workspaces for package management
- Use TypeScript project references for incremental builds
- Keep build configuration minimal
- Prefer defaults over custom configuration

## Shared Types

- Domain types live in `packages/core/`
- Both CLI and Web import types from core
- Never duplicate type definitions across packages
- Use `export type` for type-only exports

## Build Order

1. `packages/core/` - Built first (no dependencies)
2. `apps/cli/` - Built after core
3. `apps/web/` - Built after core

## Adding New Packages

Before adding a new package:
1. Does it fit the existing three-package structure?
2. Can it be a module within an existing package?
3. Does it introduce a new dependency direction?
4. Is the overhead justified by the benefit?

Prefer fewer packages over more.
