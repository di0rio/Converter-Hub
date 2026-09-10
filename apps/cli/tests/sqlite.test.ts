import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { sqliteCommand } from '../src/commands/sqlite.js'

/**
 * The CLI has a filesystem, so it finds the -wal beside the database rather
 * than being handed it. That is the behaviour worth testing here: everything
 * downstream is the same code the web app runs.
 *
 * Fixtures are built at test time and hold invented data.
 */

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cli-sqlite-'))
})

const out: string[] = []
afterEach(() => {
  out.length = 0
  vi.restoreAllMocks()
})

function capture() {
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk))
    return true
  })
}

/**
 * Connections left open on purpose. Closing the last one checkpoints the log
 * away, and the garbage collector would close an unreferenced one whenever it
 * ran — so without this list the fixture loses its WAL at random.
 */
const open: DatabaseSync[] = []

/** Build a database, leaving `walOnly` stranded in the write-ahead log. */
function build(name: string, schema: string, walOnly?: string): string {
  const path = join(dir, `${name}.db`)
  const db = new DatabaseSync(path)
  open.push(db)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA wal_autocheckpoint=0')
  db.exec(schema)
  if (walOnly) {
    db.exec('PRAGMA wal_checkpoint(FULL)')
    db.exec(walOnly)
  } else {
    db.close()
  }
  return path
}

describe('sqlite command', () => {
  it('converts a database to one CSV per table', async () => {
    const path = build(
      'plain',
      `CREATE TABLE crew (id INTEGER, name TEXT);
       CREATE TABLE ships (id INTEGER);
       INSERT INTO crew VALUES (1,'Ada');`,
    )
    const zip = join(dir, 'plain-out.zip')
    capture()
    await sqliteCommand([path], { output: zip })

    expect(existsSync(zip)).toBe(true)
    const files = unzipSync(readFileSync(zip))
    expect(Object.keys(files).sort()).toEqual(['crew.csv', 'ships.csv'])
    expect(strFromU8(files['crew.csv'] as Uint8Array)).toContain('Ada')
  })

  // The CLI must pick the -wal up on its own.
  it('reads the write-ahead log sitting beside the database', async () => {
    const path = build(
      'walcli',
      `CREATE TABLE t (id INTEGER, v TEXT); INSERT INTO t VALUES (1,'checkpointed');`,
      `INSERT INTO t VALUES (2,'only-in-wal');`,
    )
    expect(existsSync(`${path}-wal`)).toBe(true)

    const zip = join(dir, 'walcli-out.zip')
    capture()
    await sqliteCommand([path], { output: zip })

    const csv = strFromU8(unzipSync(readFileSync(zip))['t.csv'] as Uint8Array)
    expect(csv).toContain('checkpointed')
    expect(csv).toContain('only-in-wal')
  })

  it('writes one SQL document carrying the original schema', async () => {
    const path = build(
      'sqlout',
      `CREATE TABLE crew (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
       INSERT INTO crew VALUES (1,'Ada');`,
    )
    const zip = join(dir, 'sqlout.zip')
    capture()
    await sqliteCommand([path], { output: zip, format: 'sql' })

    const sql = strFromU8(
      unzipSync(readFileSync(zip))['sqlout.sql'] as Uint8Array,
    )
    expect(sql).toContain('CREATE TABLE crew (id INTEGER PRIMARY KEY')
    expect(sql).toContain("(1,'Ada')")
  })

  it('converts only the tables named', async () => {
    const path = build(
      'subset',
      `CREATE TABLE a (x INTEGER); CREATE TABLE b (y INTEGER);
       INSERT INTO a VALUES (1); INSERT INTO b VALUES (2);`,
    )
    const zip = join(dir, 'subset.zip')
    capture()
    await sqliteCommand([path], { output: zip, tables: 'a' })
    expect(Object.keys(unzipSync(readFileSync(zip)))).toEqual(['a.csv'])
  })

  it('refuses a file that is not a SQLite database', async () => {
    const path = join(dir, 'fake.db')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, 'definitely not a database')
    await expect(sqliteCommand([path], {})).rejects.toThrow(
      /not a SQLite database/,
    )
  })

  it('refuses a path that does not exist', async () => {
    await expect(sqliteCommand([join(dir, 'missing.db')], {})).rejects.toThrow(
      /does not exist/,
    )
  })
})

describe('sqlite command: companion files', () => {
  it('reads a -wal and -shm passed alongside the database', async () => {
    const path = build(
      'explicit',
      'CREATE TABLE crew (name TEXT);',
      "INSERT INTO crew VALUES ('Grace');",
    )
    const zip = join(dir, 'explicit.zip')
    capture()
    await sqliteCommand([path, `${path}-wal`, `${path}-shm`], { output: zip })

    const files = unzipSync(readFileSync(zip))
    expect(strFromU8(files['crew.csv'] as Uint8Array)).toContain('Grace')
  })

  // Reading one database's log over another's pages would report rows that
  // were never in the database the user named.
  it('refuses a -wal that belongs to another database', async () => {
    const left = build('left', 'CREATE TABLE t (a);')
    const right = build(
      'right',
      'CREATE TABLE t (a);',
      'INSERT INTO t VALUES (1);',
    )

    await expect(sqliteCommand([left, `${right}-wal`], {})).rejects.toThrow(
      /different database/,
    )
  })

  it('refuses companion files passed without the database', async () => {
    const path = build(
      'orphan',
      'CREATE TABLE t (a);',
      'INSERT INTO t VALUES (1);',
    )

    await expect(sqliteCommand([`${path}-shm`], {})).rejects.toThrow(
      /database file itself/,
    )
  })
})
