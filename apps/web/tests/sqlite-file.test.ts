import { describe, it, expect, beforeAll } from 'vitest'
import initSqlJs from 'sql.js'
import type { SqlJsStatic } from 'sql.js'
import { parseDump } from '@sql-extractor/core'
import { dumpFromDatabase, isSqliteFile } from '@/lib/sqlite-file'

/**
 * The binary reader earns its place only if the dump it writes survives the
 * parser the rest of the tool runs on. Each test builds a real SQLite database
 * in memory, renders it, and reads the result back through `parseDump` — the
 * same round trip a user's `.db` file makes.
 */

let SQL: SqlJsStatic

// Node resolves the WASM binary next to the module; only the browser build
// needs the copy served from public/.
beforeAll(async () => {
  SQL = await initSqlJs()
})

function dumpOf(statements: string): string {
  const db = new SQL.Database()
  try {
    db.run(statements)
    return dumpFromDatabase(db)
  } finally {
    db.close()
  }
}

describe('isSqliteFile', () => {
  it('recognises the SQLite header', () => {
    const db = new SQL.Database()
    db.run('CREATE TABLE t (a)')
    const bytes = db.export()
    db.close()
    expect(isSqliteFile(bytes.buffer as ArrayBuffer)).toBe(true)
  })

  it('rejects a text dump, whatever it is named', () => {
    const text = new TextEncoder().encode('CREATE TABLE t (a);\nINSERT INTO t')
    expect(isSqliteFile(text.buffer as ArrayBuffer)).toBe(false)
  })

  it('rejects a file too short to carry a header', () => {
    expect(isSqliteFile(new Uint8Array([0x53, 0x51]).buffer)).toBe(false)
  })
})

describe('dumpFromDatabase', () => {
  it('round-trips tables and rows through the SQL parser', () => {
    const dump = dumpOf(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);
      INSERT INTO users VALUES (1, 'ada'), (2, 'grace');
      INSERT INTO notes VALUES (1, 'hello');
    `)

    const parsed = parseDump(dump)
    expect(parsed.format).toBe('sqlite')

    const [database] = parsed.databases
    expect(database?.name).toBe('main')
    expect(database?.tables.map((t) => t.name).sort()).toEqual([
      'notes',
      'users',
    ])

    const users = database?.tables.find((t) => t.name === 'users')
    expect(users?.dataStatements).toHaveLength(2)
    expect(users?.createStatement).toContain('CREATE TABLE users')
  })

  it('keeps a quote in a value as data, not as syntax', () => {
    const db = new SQL.Database()
    db.run('CREATE TABLE t (v TEXT)')
    db.run('INSERT INTO t VALUES (?)', ["'); DROP TABLE t; --"])
    const dump = dumpFromDatabase(db)
    db.close()

    // One row in, one row out: the payload did not become a second statement.
    const table = parseDump(dump).databases[0]?.tables[0]
    expect(table?.dataStatements).toHaveLength(1)
    expect(dump).toContain("'''); DROP TABLE t; --'")
  })

  it('writes NULL, numbers and blobs in their SQLite forms', () => {
    const db = new SQL.Database()
    db.run('CREATE TABLE t (a, b, c)')
    db.run('INSERT INTO t VALUES (?, ?, ?)', [
      null,
      42.5,
      new Uint8Array([0x00, 0xff, 0x0a]),
    ])
    const dump = dumpFromDatabase(db)
    db.close()

    expect(dump).toContain("INSERT INTO \"t\" VALUES(NULL,42.5,X'00ff0a');")
  })

  it('emits indexes after the tables they belong to', () => {
    const dump = dumpOf(`
      CREATE TABLE t (a);
      CREATE INDEX t_a ON t (a);
    `)
    expect(dump.indexOf('CREATE TABLE t')).toBeLessThan(
      dump.indexOf('CREATE INDEX t_a'),
    )
  })

  it('skips SQLite internal tables', () => {
    const dump = dumpOf(`
      CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT);
      INSERT INTO t (v) VALUES ('x');
    `)
    expect(dump).not.toContain('CREATE TABLE sqlite_sequence')
  })

  it('produces a replayable script for an empty database', () => {
    const dump = dumpOf('')
    expect(dump).toContain('BEGIN TRANSACTION;')
    expect(dump).toContain('COMMIT;')
  })
})
