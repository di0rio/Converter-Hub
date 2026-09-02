# SQL Database Extractor — Implementation Plan

> **For agentic workers:** Use the appropriate specialized agent for each task. Follow the development order strictly.

**Goal:** Build a MySQL/MariaDB SQL dump extraction tool with Web UI, CLI, and shared Core library.

**Architecture:** Monorepo with three packages: `packages/core` (SQL parsing/extraction), `apps/cli` (command-line interface), `apps/web` (Next.js web interface). Core owns all business logic. CLI and Web consume Core.

**Tech Stack:** Bun, TypeScript (strict), Next.js 16+, React 19, Tailwind CSS 4, COSS UI, Lucide React, Vitest

## Status

All implementation phases are **complete and green**:

- **Core** — 71 tests passing; parse, extract, generation implemented; build + typecheck pass
  (`packages/core/src/{types,parser,extractor,index}.ts`, `packages/core/dist/`)
- **CLI** — 8 tests passing; interactive + `--database/--all/--tables/--output` flags
  (`apps/cli/src/{index.ts,commands,utils}`)
- **Web** — 20 tests passing; `useSqlDump` hook + components, client-side processing only
  (`apps/web/{hooks,components}`)
- **Integration** — `bun run typecheck`, `bun run test`, `bun run build` all pass from root.
  Both CLI and Web import `@sql-extractor/core` (no duplicated logic).
- **Open source** — `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `LICENSE`,
  `.github/` (issue templates, PR template, `ci.yml`).
- **Security/privacy** — local-only processing, no telemetry/analytics/external APIs; synthetic
  fixtures only (`example.com`); no `.env`/secrets/credentials in tree.

**Remaining / known caveats (require user action, not automated):**
- **Commit & release-readiness:** no commits have been made. Untracked source includes
  `packages/core/src/parser/`, `packages/core/src/extractor/`, `packages/core/tests/`,
  `apps/cli/src/commands|utils|tests`, and all `apps/web` work. `git add` + commit before release.
- **Web lint is a pre-existing tooling failure:** `eslint-config-next`'s `typescript-eslint` does
  not yet support the scaffold's TypeScript 7.0. Non-blocking for typecheck/test/build.
- **Vitest duplicate-React fix:** Bun hard-links react into divergent paths, causing React 19
  hook crashes in tests. Resolved via symlinks + `resolve.dedupe` (see
  `apps/web/scripts/ensure-react-symlinks.mjs`, wired as `postinstall`).

## Global Constraints

- MySQL and MariaDB ONLY — no PostgreSQL, SQLite, generic SQL
- TypeScript strict mode
- All processing local — no external APIs, no telemetry
- Synthetic test data only — never real production dumps
- All public documentation in English
- KISS, YAGNI, DRY
- COSS UI for web components
- Lucide React for icons
- Bun as package manager

---

## Phase 1: Foundation

### Task 1.1: Initialize Monorepo

**Agent:** integration-agent
**Files:**
- Create: `package.json` (root)
- Create: `.gitignore`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`

**Steps:**

- [ ] Initialize git at project root: `git init`
- [ ] Create root `package.json` with workspaces:
```json
{
  "name": "sql-database-extractor",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "dev:web": "bun run --filter web dev",
    "dev:cli": "bun run --filter sql-extractor dev",
    "build": "bun run --filter core build && bun run --filter sql-extractor build && bun run --filter web build",
    "test": "bun run --filter core test && bun run --filter sql-extractor test && bun run --filter web test",
    "typecheck": "bun run --filter core typecheck && bun run --filter sql-extractor typecheck && bun run --filter web typecheck",
    "lint": "bun run --filter web lint"
  }
}
```
- [ ] Create root `.gitignore`:
```
node_modules/
.env
.env.*
*.dump
*.bak
.next/
.turbo/
coverage/
dist/
*.tsbuildinfo
.DS_Store
*.pem
```
- [ ] Create `packages/core/package.json`:
```json
{
  "name": "@sql-extractor/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```
- [ ] Create `packages/core/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noEmit": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```
- [ ] Create `apps/cli/package.json`:
```json
{
  "name": "sql-extractor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "sql-extractor": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@sql-extractor/core": "workspace:*",
    "commander": "^12.0.0",
    "prompts": "^2.4.2"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@types/node": "^20.0.0",
    "@types/prompts": "^2.4.0"
  }
}
```
- [ ] Create `apps/cli/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": false,
    "strict": true,
    "noEmit": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```
- [ ] Run `bun install` from root
- [ ] Verify workspace resolution: `bun run --filter core typecheck`

---

### Task 1.2: Create Core Type Definitions

**Agent:** core-agent
**Files:**
- Create: `packages/core/src/types/index.ts`
- Create: `packages/core/src/index.ts` (barrel export)

**Interfaces to define:**

```typescript
// types/index.ts

export interface SqlDump {
  databases: Database[]
  preamble: string      // SET statements before first database
  postamble: string     // trailing statements
}

export interface Database {
  name: string
  createStatement: string   // CREATE DATABASE statement
  useStatement: string      // USE statement
  tables: Table[]
}

export interface Table {
  name: string
  database: string
  createStatement: string   // CREATE TABLE statement (full DDL)
  insertStatements: string[] // All INSERT INTO statements
  indexes: string[]         // CREATE INDEX statements if separate
  lockStatement?: string    // LOCK TABLES
  unlockStatement?: string  // UNLOCK TABLES
}

export interface ExtractionOptions {
  database: string
  tables: string[] | 'all'
}

export interface ExtractionResult {
  sql: string
  database: string
  tableCount: number
}
```

**Steps:**

- [ ] Create `packages/core/src/types/index.ts` with all interfaces
- [ ] Create `packages/core/src/index.ts` exporting types
- [ ] Run `bun run --filter core typecheck` — should pass
- [ ] Commit

---

### Task 1.3: Create Sample SQL Fixture

**Agent:** core-agent
**Files:**
- Create: `examples/sample-mysql-dump.sql`

**Content must include:**
- Header comments and SET statements
- Two databases
- Multiple tables per database
- Various column types (INT, VARCHAR, TEXT, DATETIME, ENUM, BINARY)
- PRIMARY KEY, UNIQUE KEY, INDEX, FOREIGN KEY
- ENGINE and CHARSET declarations
- INSERT statements (single and multi-row)
- Empty table
- Table with no INSERTs
- UTF-8 data
- Backtick identifiers
- AUTO_INCREMENT
- LOCK/UNLOCK TABLES
- Conditional comments `/*!40101 ... */`

**Steps:**

- [ ] Create `examples/sample-mysql-dump.sql` with comprehensive synthetic data
- [ ] Verify file is valid UTF-8
- [ ] Commit

---

## Phase 2: Core Library

### Task 2.1: SQL Parser

**Agent:** core-agent
**Files:**
- Create: `packages/core/src/parser/index.ts`
- Create: `packages/core/src/parser/Tokenizer.ts`
- Create: `packages/core/tests/parser.test.ts`

**Parser must handle:**
- Tokenize SQL into meaningful chunks (statements, not individual tokens)
- Identify statement types: CREATE DATABASE, USE, CREATE TABLE, INSERT INTO, LOCK, UNLOCK, SET, comments
- Extract database names from CREATE DATABASE and USE
- Extract table names from CREATE TABLE and INSERT INTO
- Preserve original SQL text for each statement
- Handle multi-line statements
- Handle conditional comments `/*!40101 ... */`
- Handle backtick identifiers
- Handle string literals with escapes

**Algorithm:**
1. Read entire SQL string
2. Split into statements by detecting `;` at statement boundaries (respecting strings, comments)
3. Classify each statement by its leading keyword
4. Group statements into databases and tables
5. Return `SqlDump` structure

**Steps:**

- [ ] Write test for basic parsing of sample dump
- [ ] Implement Tokenizer (statement splitting)
- [ ] Implement statement classification
- [ ] Implement database detection
- [ ] Implement table detection
- [ ] Implement full `parseSqlDump()` function
- [ ] Run tests — all pass
- [ ] Run typecheck — passes
- [ ] Commit

---

### Task 2.2: Extractor

**Agent:** core-agent
**Files:**
- Create: `packages/core/src/extractor/index.ts`
- Create: `packages/core/tests/extractor.test.ts`

**Extractor must:**
- Accept parsed `SqlDump` and `ExtractionOptions`
- Filter to requested database
- Filter to requested tables (or all)
- Return `ExtractionResult` with complete SQL
- Preserve table definitions, INSERTs, indexes, constraints
- Preserve encoding declarations
- Be deterministic (same input → same output)
- Not mutate the original parsed representation

**Output SQL structure:**
```sql
-- Extracted from dump.sql
-- Database: my_database
-- Tables: users, orders

SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT;
/*!40101 SET NAMES utf8mb4 */;

CREATE DATABASE IF NOT EXISTS `my_database` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;
USE `my_database`;

-- Table: users
CREATE TABLE `users` ( ... );
LOCK TABLES `users` WRITE;
INSERT INTO `users` VALUES (...);
UNLOCK TABLES;

-- Table: orders
CREATE TABLE `orders` ( ... );
LOCK TABLES `orders` WRITE;
INSERT INTO `orders` VALUES (...);
UNLOCK TABLES;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
```

**Steps:**

- [ ] Write test for extracting all tables from a database
- [ ] Write test for extracting specific tables
- [ ] Write test for extracting from multi-database dump
- [ ] Write test for empty database
- [ ] Write test for table with no INSERTs
- [ ] Implement `extractDatabase()` function
- [ ] Implement SQL generation (output formatting)
- [ ] Run tests — all pass
- [ ] Run typecheck — passes
- [ ] Commit

---

### Task 2.3: Core Public API

**Agent:** core-agent
**Files:**
- Modify: `packages/core/src/index.ts`

**Public API:**
```typescript
export { parseSqlDump } from './parser'
export { extractDatabase } from './extractor'
export type { SqlDump, Database, Table, ExtractionOptions, ExtractionResult } from './types'
```

**Steps:**

- [ ] Update `packages/core/src/index.ts` with public exports
- [ ] Create `packages/core/tests/integration.test.ts` with end-to-end test (parse → extract → verify output)
- [ ] Run all core tests — pass
- [ ] Run typecheck — passes
- [ ] Build core: `bun run --filter core build`
- [ ] Commit

---

## Phase 3: CLI + Web (Parallel)

> CLI and Web may run in parallel. They modify different directories.

### Task 3.1: CLI Implementation

**Agent:** cli-agent
**Files:**
- Create: `apps/cli/src/index.ts` (entry point)
- Create: `apps/cli/src/commands/extract.ts`
- Create: `apps/cli/src/utils/output.ts`
- Create: `apps/cli/tests/extract.test.ts`

**CLI must support:**

Interactive mode:
```bash
sql-extractor dump.sql
```
→ Prompts: select database → select tables → output file

Non-interactive mode:
```bash
sql-extractor dump.sql --database mydb --all --output result.sql
sql-extractor dump.sql --database mydb --tables users,orders --output result.sql
```

**Commands:**
- `sql-extractor <file>` — interactive extraction
- `sql-extractor <file> --database <name> --all --output <file>` — non-interactive all tables
- `sql-extractor <file> --database <name> --tables <list> --output <file>` — non-interactive specific tables

**Error messages (English, safe):**
- `Error: File not found: <path>`
- `Error: Unable to parse SQL dump.`
- `Error: No databases found in dump.`
- `Error: Database not found: <name>`
- `Error: Table not found: <name>`
- `Error: Unable to generate output file.`

**Steps:**

- [ ] Write test for CLI argument parsing
- [ ] Implement argument parsing with commander
- [ ] Implement interactive prompts
- [ ] Implement extraction workflow
- [ ] Implement file output
- [ ] Add shebang and make executable
- [ ] Run tests — pass
- [ ] Run typecheck — passes
- [ ] Commit

---

### Task 3.2: Web Interface

**Agent:** web-agent
**Files:**
- Modify: `client/app/page.tsx` (replace boilerplate)
- Modify: `client/app/layout.tsx` (update metadata)
- Create: `client/components/sql-extractor.tsx` (main component)
- Create: `client/components/file-upload.tsx`
- Create: `client/components/database-select.tsx`
- Create: `client/components/table-select.tsx`
- Create: `client/components/summary.tsx`
- Create: `client/hooks/use-sql-dump.ts`

**Web must implement the 5-step workflow:**

1. **File Upload** — Select SQL file
2. **Database Select** — Radio selection of detected databases
3. **Table Select** — Checkbox selection of tables (with "Select all")
4. **Summary** — Show selected database and table count
5. **Download** — Generate and download extracted SQL

**UI must be:**
- Minimal — no sidebar, no dashboard, no unnecessary navigation
- COSS UI components
- Lucide React icons
- Accessible (keyboard nav, screen reader support)
- Responsive

**Constraints:**
- Process SQL client-side (in browser)
- No server-side processing
- No API routes for SQL processing
- No file upload to server
- No persistent storage

**Steps:**

- [ ] Design component hierarchy
- [ ] Implement `useSqlDump` hook (parse, manage state)
- [ ] Implement `FileUpload` component
- [ ] Implement `DatabaseSelect` component
- [ ] Implement `TableSelect` component
- [ ] Implement `Summary` component
- [ ] Implement main `SqlExtractor` component (orchestrates flow)
- [ ] Update `page.tsx` to use SqlExtractor
- [ ] Update `layout.tsx` metadata
- [ ] Test in browser — full workflow
- [ ] Verify accessibility
- [ ] Run typecheck — passes
- [ ] Run lint — passes
- [ ] Commit

---

## Phase 4: Integration

### Task 4.1: Wire Core into CLI

**Agent:** integration-agent
**Files:**
- Verify: `apps/cli/src/index.ts` imports from `@sql-extractor/core`
- Verify: No duplicate parsing logic in CLI

**Steps:**

- [ ] Verify CLI imports from core (not duplicating logic)
- [ ] Run CLI end-to-end test with sample dump
- [ ] Verify error handling
- [ ] Commit

---

### Task 4.2: Wire Core into Web

**Agent:** integration-agent
**Files:**
- Verify: `client/` imports from `@sql-extractor/core`
- Verify: No duplicate parsing logic in web

**Steps:**

- [ ] Verify web imports from core
- [ ] Run web end-to-end test in browser
- [ ] Verify no server-side SQL processing
- [ ] Commit

---

### Task 4.3: Monorepo Build Validation

**Agent:** integration-agent
**Files:**
- Verify: Root build script works
- Verify: All typechecks pass
- Verify: All tests pass

**Steps:**

- [ ] Run `bun install` from root
- [ ] Run `bun run build` from root
- [ ] Run `bun run test` from root
- [ ] Run `bun run typecheck` from root
- [ ] Verify no circular dependencies
- [ ] Commit

---

## Phase 5: Security Audit

### Task 5.1: Security Review

**Agent:** security-agent
**Files:** Read-only review of all source files

**Checklist:**
- [ ] No SQL contents logged anywhere
- [ ] No INSERT values in error messages
- [ ] No sensitive data in console output
- [ ] No external network requests for SQL processing
- [ ] No file persistence beyond necessary
- [ ] No path traversal vulnerabilities
- [ ] No unsafe file handling
- [ ] No dependency vulnerabilities
- [ ] No secrets in source code
- [ ] No telemetry or analytics
- [ ] Error messages are safe (no SQL exposure)
- [ ] Web processes SQL client-side only
- [ ] CLI doesn't log file contents
- [ ] .gitignore covers sensitive files

---

### Task 5.2: Secret Scanning

**Agent:** security-agent
**Files:** Scan entire repository

**Search for:**
- `password`, `passwd`, `secret`, `token`, `api_key`, `apikey`
- `private_key`, `BEGIN PRIVATE KEY`
- `DATABASE_URL`, `AWS_`, `OPENAI_`, `ANTHROPIC_`
- Real email addresses (non-example.com)
- Real phone numbers
- IP addresses
- Hardcoded URLs to internal services

---

## Phase 6: QA

### Task 6.1: Core Tests

**Agent:** qa-agent
**Files:**
- Verify: `packages/core/tests/` has comprehensive coverage

**Test cases:**
- [ ] Parse single database dump
- [ ] Parse multi-database dump
- [ ] Parse dump with empty tables
- [ ] Parse dump with no INSERTs
- [ ] Parse dump with foreign keys
- [ ] Parse dump with constraints
- [ ] Parse dump with UTF-8 data
- [ ] Parse dump with backtick identifiers
- [ ] Parse dump with conditional comments
- [ ] Parse dump with multi-line INSERT
- [ ] Extract all tables from database
- [ ] Extract specific tables
- [ ] Extract from empty database
- [ ] Output is deterministic
- [ ] Original parsed representation not mutated
- [ ] Handle empty file gracefully
- [ ] Handle malformed SQL gracefully

---

### Task 6.2: CLI Tests

**Agent:** qa-agent
**Files:**
- Verify: `apps/cli/tests/` has coverage

**Test cases:**
- [ ] Parse arguments correctly
- [ ] Interactive mode works
- [ ] Non-interactive mode works
- [ ] Error messages are safe
- [ ] Exit codes are correct
- [ ] Handle missing file
- [ ] Handle invalid SQL
- [ ] Handle missing database
- [ ] Handle missing table

---

### Task 6.3: Web Tests

**Agent:** qa-agent
**Files:**
- Verify: Web components render correctly

**Test cases:**
- [ ] File upload works
- [ ] Database selection works
- [ ] Table selection works
- [ ] Summary displays correctly
- [ ] Download generates valid SQL
- [ ] Empty state displays correctly
- [ ] Error states display correctly
- [ ] Accessibility checks pass

---

## Phase 7: Open Source

### Task 7.1: Documentation

**Agent:** opensource-agent
**Files:**
- Create: `README.md`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `CHANGELOG.md`
- Create: `LICENSE` (MIT)

---

### Task 7.2: Repository Hygiene

**Agent:** opensource-agent
**Files:**
- Verify: No sensitive data
- Verify: No internal references
- Verify: No Portuguese in public files
- Verify: .gitignore is comprehensive
- Verify: All docs are in English

---

## Task Dependency Graph

```
1.1 (Foundation)
  ↓
1.2 (Types) → 1.3 (Fixture)
  ↓
2.1 (Parser) → 2.2 (Extractor) → 2.3 (Core API)
  ↓                                ↓
3.1 (CLI) ←──────────────────────→ 3.2 (Web)  [parallel]
  ↓                                ↓
4.1 (Wire CLI) + 4.2 (Wire Web) + 4.3 (Build)
  ↓
5.1 (Security) + 5.2 (Secret Scan)
  ↓
6.1 (Core Tests) + 6.2 (CLI Tests) + 6.3 (Web Tests)
  ↓
7.1 (Docs) + 7.2 (Hygiene)
```
