# Firebird database reader (.fdb) - design

Date: 2026-09-11. Status: approved direction, awaiting spec review.

## Problem

The SQL tool reads Firebird *scripts* (what `isql -x` writes), but not a
Firebird database file itself. A user has `DADOS.FDB`, about 30 MB, and wants
its tables out as spreadsheets. Today the tool refuses it, as it refuses any
binary it does not recognise.

The file's header (first 96 bytes, read on the user's machine):

| Field | Offset | Bytes | Value |
|---|---|---|---|
| Page type | 0x00 | `01` | header page |
| Page size | 0x10 | `00 40` | 16384 |
| ODS major | 0x12 | `0b 80` | 11, with the Firebird flag `0x8000` |
| ODS minor | 0x3e | `02 00` | 2 - ODS 11.2, Firebird 2.5 |
| RDB$PAGES pointer page | 0x14 | `03 00 00 00` | page 3 |
| Next transaction | 0x24 | `16 0b 2b 00` | 2 821 910 |

## Decision

Read the file natively, in TypeScript, with no Firebird engine and no
dependency, the way the SQLite reader reads a `.db` - but by parsing the
on-disk structure directly, since there is no Firebird build for the browser.

Only ODS 11 (Firebird 2.0, 2.1 and 2.5) is supported. It is the version the
official *Firebird Internals* document describes, and the one the user has.
Every other ODS - 10 (Firebird 1.x, InterBase), 12 (Firebird 3), 13 (4 and 5)
- is refused with a message that names the version found. The project's rule
holds: refuse rather than guess.

## Scope

In:

- ODS 11.0, 11.1 and 11.2, any valid page size (1024 to 16384).
- Every user table: its columns, rows and row count.
- Types: SMALLINT, INTEGER, BIGINT, NUMERIC/DECIMAL (any storage), FLOAT,
  DOUBLE PRECISION, DATE, TIME, TIMESTAMP, CHAR, VARCHAR, BLOB (text and
  binary).
- Tables altered after rows were written (records in older formats).
- Row versions: only committed data is shown (see *Row versions*).
- Character sets NONE, OCTETS, ASCII, UNICODE_FSS, UTF8, ISO8859_1 and the
  WIN125x family; others are refused per table.
- The web app, inside the SQL tool, detected by content.

Out:

- ODS other than 11, InterBase `.gdb` files, multi-file databases and shadows
  (refused).
- ARRAY columns, external tables and global temporary tables (the table is
  listed as unreadable, with the reason).
- Views, computed columns, indexes, constraints, generators, procedures and
  triggers in the output. Views and computed columns are not stored data;
  the rest is schema this tool does not reproduce for any engine.
- The CLI. The web limit (256 MB, as for SQLite) covers the case in hand; the
  CLI can reuse the core reader later.
- Writing or repairing a database.

## Architecture

A new core module, `packages/core/src/fdb/`, with no dependency on the web or
the CLI, split so each file holds one layer of the format:

| File | Purpose |
|---|---|
| `header.ts` | Validate the header page; read page size, ODS version, the RDB$PAGES pointer page and the next transaction. `isFdbFile(head)` for detection. |
| `pages.ts` | Page access by number with bounds and page-type checks; walk a relation's pointer-page chain to its data pages. |
| `records.ts` | Record header, fragment chains, back-version chains, RLE decompression, delta (difference) records. |
| `transactions.ts` | Read transaction inventory pages; answer "is transaction N committed". |
| `system.ts` | The fixed layouts of the system relations the reader needs (RDB$PAGES, RDB$DATABASE, RDB$FIELDS, RDB$RELATION_FIELDS, RDB$RELATIONS, RDB$FORMATS, RDB$CHARACTER_SETS), taken from Firebird 2.5's `src/jrd/relations.h` and verified against a real file. |
| `format.ts` | Decode an RDB$FORMATS descriptor blob into the field descriptors of one record format. |
| `values.ts` | Turn a field's bytes into a value: integers, scaled decimals, floats, dates, text in its character set, blobs. |
| `blobs.ts` | Read a blob by id: level 0 (inline), 1 (page list) and 2 (pointer pages). |
| `index.ts` | `readFdbDatabase(bytes, { rowLimit })`, `FdbReadError`, and the exported types. |

### Bootstrapping

1. The header gives the page size and the first pointer page of RDB$PAGES
   (relation 0).
2. RDB$PAGES, read with its fixed layout, gives the pointer pages of every
   relation and the transaction inventory pages.
3. RDB$RELATIONS, RDB$RELATION_FIELDS, RDB$FIELDS, RDB$FORMATS and
   RDB$CHARACTER_SETS, read with their fixed layouts, give each user table's
   name, columns in position order, types, character sets and record formats.
4. Each user table's data pages are read, and every record is decoded with the
   format its own header names.

### Output shape

`readFdbDatabase` returns the same shape the SQLite reader returns -
`{ tables, unreadable }`, where a table has `name`, `columns`
(`name`, `declaredType`, `primaryKey`, `notNull`), `rows`, `rowCount`,
`createStatement` and `indexStatements` (always empty). So the table picker,
the preview, the row limit and every export writer work unchanged.

- `declaredType` is the Firebird type as written in DDL (`VARCHAR(60)`,
  `NUMERIC(15,2)`, `TIMESTAMP`).
- `createStatement` is a Firebird `CREATE TABLE` built from the metadata.
- Values use the existing value union: number, bigint, string, Uint8Array or
  null.
  - NUMERIC and DECIMAL become an exact decimal string (`"1234.50"`), never a
    float, because money is the usual content.
  - DATE is `YYYY-MM-DD`; TIME is `HH:MM:SS.ffff`; TIMESTAMP joins the two
    with a space. All come from Firebird's Modified Julian day number and its
    1/10000-second fractions, with no timezone.
  - CHAR has its trailing pad spaces removed. VARCHAR is read up to its
    length prefix.
  - A text blob is decoded in the column's character set; any other blob stays
    bytes, which text exports already write as Base64.

The shared types are renamed from `Sqlite*` to engine-neutral names (for
example `DatabaseTable`), with the old names kept as aliases, so neither
reader pretends to be the other.

### Row versions

Firebird keeps several versions of a row, one per transaction that touched it.
A copied file can hold versions from transactions that never committed. For
each record:

1. Read the primary version and its transaction number.
2. If that transaction is committed according to the transaction inventory,
   use this version; if the version is marked deleted, the row is gone.
3. Otherwise follow the back-version pointer. A back version may be a delta
   against the newer version; apply it. Repeat.
4. A transaction at or beyond the header's next transaction, active, in limbo
   or dead counts as not committed.

The result is the committed state of the database at the moment it was
copied, which is what the user would see after a clean restart.

### Character sets

Each column's character set comes from RDB$FIELDS. NONE means "whatever the
client sent", so it falls back to the database default in RDB$DATABASE, and
if that is NONE too, to WIN1252 - the usual encoding of Brazilian legacy
systems. The fallback is stated in the README. Decoding uses `TextDecoder`,
with no table of our own. A column in a character set outside the supported
list makes its table unreadable, rather than showing mojibake.

## Web integration

- `isFdbFile` checks the header by content, never by name, the same way SQLite
  files are detected: page type 1, a page size that is a power of two from
  1024 to 16384, and the `0x8000` flag in the ODS field. A file that is a
  Firebird database of another ODS is detected as Firebird and then refused
  with its version named, not treated as unknown.
- `sql-tool.tsx` routes a Firebird file to the same converter flow as a SQLite
  file. The converter's hook takes the reader as a parameter instead of
  importing the SQLite one.
- The SQL tool's hub card adds "Firebird databases" to what it reads.
- SQL export writes the synthesised Firebird `CREATE TABLE` and the rows as
  INSERTs, through the same writer the SQLite export uses.

## Errors and safety

The file is untrusted binary input.

- Every page number, slot offset, length and fragment pointer is
  bounds-checked before it is read. A value out of range raises
  `FdbReadError`.
- Every chain (pointer pages, fragments, back versions, blob pages) keeps a
  visited set, so a loop in a damaged file ends in an error, not a hang.
- RLE output is capped at the format's record length, so a crafted record
  cannot expand without limit.
- Messages are fixed text and never quote the file: "This Firebird database
  was written by Firebird 3 (ODS 12). This tool reads Firebird 2.x (ODS 11)
  databases.", "This Firebird database is damaged.", and so on.
- The size ceiling is checked before reading, as for SQLite. No WebAssembly,
  so the CSP does not change.

## Testing

**Unit tests** use crafted byte arrays, with no fixture file:

- header acceptance and refusal (ODS 11.0/11.2 accepted; 10, 12 and 13
  refused by name; bad page size; not a database);
- RLE vectors, including runs, literals and an overrun;
- dates, times, timestamps and scaled decimals, positive and negative;
- character set decoding and the NONE fallback.

**Fixture database.** `examples/firebird-db/` holds:

- `fixtures.sql`, with invented data only;
- `make-fixtures.sh`, which runs Firebird 2.5 in Docker, executes
  `fixtures.sql` and copies out `sample.fdb` (page size 4096);
- the generated `sample.fdb`, committed.

The fixture covers every supported type with NULLs; a table altered after
rows were written; updated and deleted rows; a row long enough to fragment;
text and binary blobs at all three levels; WIN1252 and UTF8 columns; plus a
view, a computed column and an ARRAY column, which must be left out or
reported. An integration test reads `sample.fdb` and checks exact values.

**Acceptance on the real file**, on the user's Linux machine, never
committed:

- `DADOS.FDB` opens in the SQL tool and lists its tables;
- for a sample of tables, row counts and a few rows match what Firebird 2.5
  (in Docker) returns for `SELECT COUNT(*)` and `SELECT FIRST 5 *`;
- a table exports to CSV and XLSX and opens in a spreadsheet with its
  accents intact.

## Where the work happens

The reader has to be developed against a real file. Implementation runs on
the Linux machine, where `DADOS.FDB` and Docker are available. The spec and
the plan are written here and pushed first.

## Risks

- **System relation layouts.** They are hardcoded from the 2.5 source. If a
  2.0 or 2.1 file differs, the fixture work finds it; the fallback is to
  narrow support to 11.2 and refuse the others by minor version.
- **Descriptor blob format.** The RDB$FORMATS blob layout is read from the
  2.5 source (`Ods::Descriptor`) and verified on both files before anything
  depends on it.
- **Delta records.** The difference format for back versions is the least
  documented part. If it cannot be verified, a record whose committed
  version is a delta makes its table unreadable, rather than showing the
  newer, uncommitted row.
