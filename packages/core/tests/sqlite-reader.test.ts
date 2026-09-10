import { describe, it, expect, beforeAll } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import {
  readSqliteDatabase,
  isSqliteFile,
  isWalFile,
  SqliteReadError,
} from '../src/sqlite/reader.js'
import { sqliteToTabular, sqliteToSql } from '../src/sqlite/index.js'
import type { SqliteFileSet } from '../src/sqlite/reader.js'

/**
 * Every fixture here is built in a temporary directory at test time and holds
 * invented data. No real database is committed, and none is read.
 *
 * The WAL cases are the point of this file. A reader that opens only the main
 * file passes a naive test and still loses every row a user had not checkpointed,
 * so the fixtures deliberately strand data in the write-ahead log.
 */

const require = createRequire(import.meta.url)
const wasmPath = join(
  dirname(require.resolve('wa-sqlite/dist/wa-sqlite.mjs')),
  'wa-sqlite.wasm',
)
const wasm = async () => readFileSync(wasmPath)

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sqlite-fixture-'))
})

/**
 * Build a database and return its bytes.
 *
 * `walOnly` runs after a checkpoint, so everything it writes stays in the -wal
 * until something reads it back. The connection is left open while the files are
 * copied — closing it would checkpoint and defeat the fixture.
 */
function build(
  name: string,
  schema: string,
  walOnly?: string,
): SqliteFileSet & { mainPath: string } {
  const path = join(dir, `${name}.db`)
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA wal_autocheckpoint=0')
  db.exec(schema)
  if (walOnly) {
    db.exec('PRAGMA wal_checkpoint(FULL)')
    db.exec(walOnly)
  }
  const main = readFileSync(path)
  const walPath = `${path}-wal`
  const wal = existsSync(walPath) ? readFileSync(walPath) : undefined
  if (!walOnly) db.close()
  return { main, wal, mainPath: path }
}

describe('isSqliteFile', () => {
  it('recognises a database by its header', () => {
    const { main } = build('detect', 'CREATE TABLE t (a)')
    expect(isSqliteFile(main.subarray(0, 16))).toBe(true)
  })

  it('rejects text renamed to look like a database', () => {
    const text = new TextEncoder().encode('CREATE TABLE t (a);\n-- not binary')
    expect(isSqliteFile(text)).toBe(false)
  })

  it('rejects random bytes and a truncated header', () => {
    expect(isSqliteFile(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(false)
    expect(isSqliteFile(new Uint8Array(0))).toBe(false)
  })

  it('tells a write-ahead log apart from a database', () => {
    const { wal } = build(
      'walhead',
      'CREATE TABLE t (a)',
      'INSERT INTO t VALUES (1)',
    )
    expect(wal).toBeDefined()
    expect(isWalFile((wal as Uint8Array).subarray(0, 4))).toBe(true)
    expect(isSqliteFile((wal as Uint8Array).subarray(0, 16))).toBe(false)
  })
})

describe('readSqliteDatabase', () => {
  it('reads tables, columns and rows from a plain database', async () => {
    const files = build(
      'plain',
      `CREATE TABLE crew (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
       CREATE TABLE ships (id INTEGER PRIMARY KEY, label TEXT);
       INSERT INTO crew VALUES (1,'Ada'),(2,'Grace');
       INSERT INTO ships VALUES (1,'Ember');`,
    )
    const database = await readSqliteDatabase(files, wasm)
    expect(database.tables.map((t) => t.name)).toEqual(['crew', 'ships'])

    const crew = database.tables[0]
    expect(crew?.columns.map((c) => c.name)).toEqual(['id', 'name'])
    expect(crew?.columns[0]?.primaryKey).toBe(true)
    expect(crew?.columns[1]?.notNull).toBe(true)
    expect(crew?.rowCount).toBe(2)
  })

  // The reason this reader exists.
  it('finds rows that live only in the write-ahead log', async () => {
    const files = build(
      'walrows',
      `CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);
       INSERT INTO t VALUES (1,'checkpointed');`,
      `INSERT INTO t VALUES (2,'only-in-wal'),(3,'also-only-in-wal');`,
    )
    expect(files.wal).toBeDefined()

    const withWal = await readSqliteDatabase(files, wasm)
    expect(withWal.tables[0]?.rows.map((r) => r[1])).toEqual([
      'checkpointed',
      'only-in-wal',
      'also-only-in-wal',
    ])

    // Proof the fixture is doing its job: without the WAL the rows are missing.
    const withoutWal = await readSqliteDatabase({ main: files.main }, wasm)
    expect(withoutWal.tables[0]?.rows.map((r) => r[1])).toEqual([
      'checkpointed',
    ])
  })

  it('finds a whole table created only in the write-ahead log', async () => {
    const files = build(
      'waltable',
      `CREATE TABLE early (a INTEGER); INSERT INTO early VALUES (1);`,
      `CREATE TABLE late (b TEXT); INSERT INTO late VALUES ('born in the wal');`,
    )
    const database = await readSqliteDatabase(files, wasm)
    expect(database.tables.map((t) => t.name)).toEqual(['early', 'late'])

    const withoutWal = await readSqliteDatabase({ main: files.main }, wasm)
    expect(withoutWal.tables.map((t) => t.name)).toEqual(['early'])
  })

  it('preserves every storage class without coercing between them', async () => {
    const files = build(
      'types',
      `CREATE TABLE v (i INTEGER, r REAL, t TEXT, b BLOB, n TEXT);
       INSERT INTO v VALUES (42, 1.5, 'plain', x'00ff10', NULL);
       INSERT INTO v VALUES (-7, -0.25, '007', x'', '');`,
    )
    const [table] = (await readSqliteDatabase(files, wasm)).tables
    const [first, second] = table?.rows ?? []

    expect(first?.[0]).toBe(42)
    expect(first?.[1]).toBe(1.5)
    expect(first?.[2]).toBe('plain')
    expect(first?.[3]).toBeInstanceOf(Uint8Array)
    expect([...(first?.[3] as Uint8Array)]).toEqual([0x00, 0xff, 0x10])
    expect(first?.[4]).toBeNull()

    // A leading zero is text, not a number that lost a digit.
    expect(second?.[2]).toBe('007')
    // An empty string is not NULL.
    expect(second?.[4]).toBe('')
  })

  it('keeps a 64-bit integer exact instead of rounding it', async () => {
    const files = build(
      'bigint',
      `CREATE TABLE b (n INTEGER); INSERT INTO b VALUES (9007199254740993);`,
    )
    const [table] = (await readSqliteDatabase(files, wasm)).tables
    expect(table?.rows[0]?.[0]).toBe(9007199254740993n)
  })

  it('handles unicode and awkward identifiers', async () => {
    const files = build(
      'unicode',
      `CREATE TABLE "tabela com espaço" ("coluna ""aspas""" TEXT, "ção" TEXT);
       INSERT INTO "tabela com espaço" VALUES ('日本語', 'emoji 🎈');`,
    )
    const [table] = (await readSqliteDatabase(files, wasm)).tables
    expect(table?.name).toBe('tabela com espaço')
    expect(table?.columns.map((c) => c.name)).toEqual(['coluna "aspas"', 'ção'])
    expect(table?.rows[0]).toEqual(['日本語', 'emoji 🎈'])
  })

  it('leaves SQLite internal tables out of the table list', async () => {
    const files = build(
      'internal',
      `CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT);
       INSERT INTO t (v) VALUES ('x');`,
    )
    const database = await readSqliteDatabase(files, wasm)
    expect(database.tables.map((t) => t.name)).toEqual(['t'])
  })

  it('reports a virtual table as unreadable rather than pretending', async () => {
    const files = build(
      'fts',
      `CREATE TABLE plain (a TEXT); INSERT INTO plain VALUES ('x');
       CREATE VIRTUAL TABLE docs USING fts5(body);
       INSERT INTO docs VALUES ('searchable text');`,
    )
    const database = await readSqliteDatabase(files, wasm)
    expect(database.unreadable).toEqual([{ name: 'docs', reason: 'virtual' }])
    // Neither the virtual table nor its shadow tables are offered as data.
    expect(database.tables.map((t) => t.name)).toEqual(['plain'])
  })

  it('honours a row limit without misreporting the total', async () => {
    const files = build(
      'limit',
      `CREATE TABLE many (n INTEGER);
       INSERT INTO many
         WITH RECURSIVE seq(n) AS (
           SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 500
         ) SELECT n FROM seq;`,
    )
    const [table] = (await readSqliteDatabase(files, wasm, { rowLimit: 10 }))
      .tables
    expect(table?.rows).toHaveLength(10)
    expect(table?.rowCount).toBe(500)
  })
})

describe('rejecting what is not a readable database', () => {
  it('refuses a text file renamed to .db', async () => {
    const main = new TextEncoder().encode('just text, definitely not sqlite')
    await expect(readSqliteDatabase({ main }, wasm)).rejects.toThrow(
      SqliteReadError,
    )
  })

  it('refuses an empty file', async () => {
    await expect(
      readSqliteDatabase({ main: new Uint8Array(0) }, wasm),
    ).rejects.toThrow(SqliteReadError)
  })

  it('refuses a WAL that is not a WAL', async () => {
    const files = build(
      'badwal',
      'CREATE TABLE t (a); INSERT INTO t VALUES (1)',
    )
    const wal = new TextEncoder().encode('this is not a write-ahead log at all')
    await expect(
      readSqliteDatabase({ main: files.main, wal }, wasm),
    ).rejects.toThrow(SqliteReadError)
  })

  it('refuses a truncated database instead of reading part of it', async () => {
    // Checkpointed into the main file and grown past a single page, so that
    // cutting it in half actually removes data rather than trailing zeroes.
    const path = join(dir, 'trunc.db')
    const db = new DatabaseSync(path)
    db.exec(`CREATE TABLE t (a TEXT);
             INSERT INTO t WITH RECURSIVE s(n) AS (
               SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 400
             ) SELECT 'row ' || n FROM s;`)
    db.close()
    const whole = readFileSync(path)
    expect(whole.length).toBeGreaterThan(8192)

    const cut = whole.subarray(0, Math.floor(whole.length / 2))
    await expect(readSqliteDatabase({ main: cut }, wasm)).rejects.toThrow(
      SqliteReadError,
    )
  })

  // A message that quoted the file could put the user's own data on screen.
  it('never puts database contents in the error message', async () => {
    const main = new TextEncoder().encode('secret-token-abc123 not sqlite')
    await expect(readSqliteDatabase({ main }, wasm)).rejects.toThrow(
      /not a SQLite database/,
    )
    await expect(readSqliteDatabase({ main }, wasm)).rejects.not.toThrow(
      /secret-token/,
    )
  })
})

describe('end to end, database to output', () => {
  it('carries WAL-only rows all the way into CSV-ready and SQL output', async () => {
    const files = build(
      'e2e',
      `CREATE TABLE crew (id INTEGER PRIMARY KEY, name TEXT, avatar BLOB);
       INSERT INTO crew VALUES (1,'Ada',x'00ff');`,
      `INSERT INTO crew VALUES (2,'Grace',NULL);`,
    )
    const database = await readSqliteDatabase(files, wasm)
    const [table] = database.tables

    const tabular = sqliteToTabular(table!)
    expect(tabular.columns).toEqual(['id', 'name', 'avatar'])
    expect(tabular.rows).toEqual([
      ['1', 'Ada', 'AP8='],
      ['2', 'Grace', null],
    ])

    const sql = sqliteToSql([table!])
    expect(sql).toContain('CREATE TABLE crew')
    expect(sql).toContain("(1,'Ada',X'00ff')")
    expect(sql).toContain("(2,'Grace',NULL)")
  })
})

describe('columns SQLite computes itself', () => {
  it('reads a table with generated columns without misaligning its rows', async () => {
    const files = build(
      'generated',
      `CREATE TABLE price (
         net INTEGER,
         gross INTEGER GENERATED ALWAYS AS (net * 2) VIRTUAL,
         label TEXT
       );
       INSERT INTO price (net, label) VALUES (10, 'ten');`,
    )

    const [table] = (await readSqliteDatabase(files, wasm)).tables

    // A generated value is derived, not stored. Leaving it out keeps every row
    // lined up with its header, and keeps the SQL export replayable: SQLite
    // refuses an INSERT that names a generated column.
    expect(table!.columns.map((c) => c.name)).toEqual(['net', 'label'])
    expect(table!.rows).toEqual([[10, 'ten']])
    expect(sqliteToSql([table!])).toContain(
      `INSERT INTO "price" ("net","label") VALUES\n  (10,'ten');`,
    )
  })
})

describe('a write-ahead log SQLite would skip without a word', () => {
  it('refuses a log whose header checksum is wrong instead of dropping its rows', async () => {
    const files = build(
      'walsum',
      'CREATE TABLE t (a); INSERT INTO t VALUES (1);',
      'INSERT INTO t VALUES (2);',
    )
    // SQLite treats a log with a bad header as empty and opens the main file
    // alone, which would export the database minus its latest rows.
    const wal = Uint8Array.from(files.wal!)
    wal[28] = (wal[28] as number) ^ 0xff

    await expect(
      readSqliteDatabase({ main: files.main, wal }, wasm),
    ).rejects.toThrow(SqliteReadError)
  })
})
