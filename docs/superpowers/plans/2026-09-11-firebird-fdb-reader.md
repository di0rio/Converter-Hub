# Firebird database reader (.fdb) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read a Firebird 2.x database file (`DADOS.FDB`, ODS 11.2, 16 KB pages) in the browser and export its tables through the SQL tool.

**Architecture:** A dependency-free TypeScript reader in `packages/core/src/fdb/`, built from Firebird 2.5's own source (`ods.h`, `relations.h`, `fields.h`, `ini.epp`, `sqz.cpp`, `dpm.epp`, `vio.cpp`, `blb.cpp`, `tpc.cpp`). It returns the same `{ tables, unreadable }` shape as the SQLite reader, so the web app's SQLite flow shows and exports it unchanged.

**Tech Stack:** TypeScript, DataView, TextDecoder, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-firebird-fdb-reader-design.md`

## Global Constraints

- ODS 11 only (Firebird 2.0, 2.1, 2.5). Every other ODS is refused with its version named.
- No dependency, no WebAssembly.
- Error messages are fixed text and never quote the file.
- Every offset, length and chain is bounds-checked; every chain keeps a visited set.
- Only committed row versions are returned.
- `DADOS.FDB` is never committed; tests use synthetic bytes only.

## Deviation from the spec

The spec split the reader into nine files. It is three, by layer, because the
layers share one small class and splitting them further only moved imports
around:

| File | Holds |
|---|---|
| `binary.ts` | Header, pages, records, RLE, deltas, fragments, transaction inventory, blobs, `FdbReadError`, `isFdbFile`. |
| `values.ts` | Field descriptors, null bitmap, value decoding, character sets. |
| `index.ts` | System relation layouts, catalog, version visibility, `readFdbDatabase`. |

## Format facts used (from the 2.5 source)

- Header: page size `u16@16`, ODS `u16@18` (`0x8000` = Firebird), RDB$PAGES pointer page `u32@20`, oldest interesting transaction `u32@28`, next transaction `u32@36`, ODS minor `u16@62`, minor at creation `u16@64`, clumplets from `@96` to `u16@66`. Clumplet 3 (`HDR_file`) means a multi-file database.
- Pointer page: next `u32@20`, count `u16@24`, relation `u16@26`, page vector `@32`.
- Data page: relation `u16@20`, count `u16@22`, slots `@24` (`u16` offset, `u16` length).
- Record header (13 bytes): transaction `u32@0`, back page `u32@4`, back line `u16@8`, flags `u16@10`, format `u8@12`. Fragmented header (22 bytes) adds next page `u32@16`, next line `u16@20`.
- Flags: deleted 1, chain 2, fragment 4, incomplete 8, blob 16, delta/stream 32, damaged 128.
- RLE: signed control byte; negative *n* repeats the next byte −*n* times, positive *n* copies *n* bytes. Each fragment is decompressed on its own.
- Delta: a back version of a record flagged `delta` is a difference string applied to the newer version's data.
- Transactions: 0 and anything below the oldest interesting transaction are committed; otherwise 2 bits per transaction on TIP pages (`@20`, `(pageSize − 20) × 4` per page), 3 = committed.
- Record number: `line = n % maxRecords`, `seq = n / maxRecords`, `slot = seq % dpPerPp`, `pointer = seq / dpPerPp`, with `maxRecords = (pageSize − 28) / 17` and `dpPerPp = (pageSize − 32) × 8 / 34`.
- Blob id: relation `u16@0`, record number `u32@4` + `u8@3` × 2³². Blob header: max sequence `u32@4`, flags `u16@10`, level `u8@12`, length `u32@20`, sub-type `u16@24`, charset `u8@26`, data or page vector `@28`. Blob page data `@28`, length `u16@24`. Segmented blobs prefix every segment with a `u16` length.
- System relation formats are computed, not stored: null bitmap `((n + 32) & ~31) >> 3` bytes, then each field aligned (text 1, varchar 2, others `min(length, 8)`); VARCHAR is declared + 2 from ODS 11.2, declared before it.
- User formats come from RDB$FORMATS: a blob of 12-byte descriptors (`dtype u8@0`, `scale i8@1`, `length u16@2`, `sub_type i16@4`, `offset u32@8`), one per field id.

## Tasks

### Task 1: Binary layer

**Files:** Create `packages/core/src/fdb/binary.ts`. Test `packages/core/tests/fdb.test.ts`.

- [ ] Tests: header of `DADOS.FDB` (first 96 bytes, no table data) parses as ODS 11.2 with 16 KB pages; ODS 10, 12, 13 and InterBase are refused by name; RLE runs, literals and overrun; difference strings.
- [ ] Implement `readHeader`, `isFdbFile`, `FdbFile` (page access, pointer pages, records, fragments, TIP, blobs), `decompress`, `applyDifferences`.
- [ ] Commit.

### Task 2: Values

**Files:** Create `packages/core/src/fdb/values.ts`. Test `packages/core/tests/fdb.test.ts`.

- [ ] Tests: SMALLINT/INTEGER/BIGINT, scaled decimals as exact strings, FLOAT/DOUBLE, DATE/TIME/TIMESTAMP from Modified Julian days, CHAR trimming, VARCHAR, WIN1252 and UTF8 text, NONE falling back to the database default, OCTETS as bytes.
- [ ] Implement `decodeValue`, `isNull`, `charsetLabel`, `CHARSET_IDS`.
- [ ] Commit.

### Task 3: Catalog and tables

**Files:** Create `packages/core/src/fdb/index.ts`; modify `packages/core/src/index.ts`, `packages/core/src/sqlite/index.ts` (`UnreadableTable` reasons). Test `packages/core/tests/fdb.test.ts`.

- [ ] Test: a synthetic ODS 11.2 database built in the test (system relations, a format blob, a user table with a committed row, a row whose newest version is uncommitted with a delta back version, a deleted row and a text blob) reads back with exact values.
- [ ] Implement system layouts, RDB$PAGES bootstrap, RDB$FORMATS, catalog joins, version visibility, `readFdbDatabase`.
- [ ] Commit.

### Task 4: Web integration

**Files:** Modify `apps/web/lib/sqlite-files.ts`, `apps/web/hooks/use-sqlite.ts`, `apps/web/components/sqlite-converter.tsx`, `apps/web/components/sql-extractor.tsx`, `apps/web/lib/tools.ts`, tests.

- [ ] `.fdb` and `.gdb` accepted; a Firebird header routes to the database flow; `readFdbDatabase` used instead of the SQLite reader.
- [ ] Commit.

### Task 5: Probe script, docs, gates

**Files:** Create `scripts/fdb-probe.mjs`; modify README, AGENTS.md, `apps/web/README.md`, CHANGELOG.

- [ ] `node scripts/fdb-probe.mjs <file>` prints the header, table names, row counts and unreadable tables, never row data.
- [ ] Typecheck, lint, test, build; commit; push.

### Task 6: Acceptance on the real file (Linux machine)

- [ ] `bun run --filter @sql-extractor/core build && node scripts/fdb-probe.mjs /home/diorio/Downloads/DADOS.FDB`.
- [ ] Open `DADOS.FDB` in `/sql`, export a table to CSV and XLSX, check accents and counts.
