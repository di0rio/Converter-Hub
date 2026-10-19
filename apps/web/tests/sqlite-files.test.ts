import { describe, it, expect } from 'vitest'
import { SqliteReadError } from '@sql-extractor/core'
import {
  dbfSelectionBytes,
  groupSqliteFiles,
  isDbfSelection,
  isSqliteSelection,
  readDbfSelection,
} from '@/lib/sqlite-files'

const file = (name: string, bytes = 1) =>
  new File([new Uint8Array(bytes)], name)

describe('groupSqliteFiles', () => {
  it('takes a database on its own', () => {
    const set = groupSqliteFiles([file('bonfire.db')])
    expect(set.main.name).toBe('bonfire.db')
    expect(set.wal).toBeUndefined()
  })

  it('groups a database with its companions, whatever the pick order', () => {
    const set = groupSqliteFiles([
      file('bonfire.db-wal'),
      file('bonfire.db-shm'),
      file('bonfire.db'),
    ])
    expect(set.main.name).toBe('bonfire.db')
    expect(set.wal?.name).toBe('bonfire.db-wal')
    expect(set.shm?.name).toBe('bonfire.db-shm')
  })

  it.each(['.db', '.sqlite', '.sqlite3', '.db3', ''])(
    'pairs companions for a database named with "%s"',
    (extension) => {
      const base = `data${extension}`
      const set = groupSqliteFiles([file(base), file(`${base}-wal`)])
      expect(set.main.name).toBe(base)
      expect(set.wal?.name).toBe(`${base}-wal`)
    },
  )

  it('refuses companions belonging to a different database', () => {
    expect(() =>
      groupSqliteFiles([file('database-a.db'), file('database-b.db-wal')]),
    ).toThrow(/different database/)
  })

  it('refuses a selection with no database file', () => {
    expect(() =>
      groupSqliteFiles([file('bonfire.db-wal'), file('bonfire.db-shm')]),
    ).toThrow(SqliteReadError)
    expect(() => groupSqliteFiles([file('bonfire.db-shm')])).toThrow(
      /without a -wal or -shm suffix/,
    )
  })

  it('refuses two databases at once', () => {
    expect(() => groupSqliteFiles([file('one.db'), file('two.db')])).toThrow(
      /one database at a time/,
    )
  })

  it('refuses an empty selection', () => {
    expect(() => groupSqliteFiles([])).toThrow(SqliteReadError)
  })

  it('matches companion names case-insensitively', () => {
    const set = groupSqliteFiles([file('Bonfire.DB'), file('bonfire.db-WAL')])
    expect(set.wal?.name).toBe('bonfire.db-WAL')
  })
})

describe('isSqliteSelection', () => {
  const firebird = Uint8Array.from([
    1, 0, 0x39, 0x30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0x0b, 0x80,
  ])

  it('takes a Firebird database for a database, not a dump', async () => {
    expect(await isSqliteSelection([new File([firebird], 'DADOS.FDB')])).toBe(
      true,
    )
  })

  it('takes a gbak backup for a database, whatever it is called', async () => {
    const backup = Uint8Array.from([0, 2, 4, 9, 0, 0, 0, 0])
    expect(await isSqliteSelection([new File([backup], 'LINKO.FBK')])).toBe(
      true,
    )
    expect(await isSqliteSelection([new File([backup], 'nightly.bak')])).toBe(
      true,
    )
  })

  it('takes a SQL Server backup for a database, whatever it is called', async () => {
    const tape = new Uint8Array(128)
    tape.set([0x54, 0x41, 0x50, 0x45])
    new DataView(tape.buffer).setUint16(84, 1024, true)
    expect(await isSqliteSelection([new File([tape], 'nightly.jnmbak')])).toBe(
      true,
    )
  })

  it('takes a text file for a dump', async () => {
    expect(
      await isSqliteSelection([new File(['CREATE TABLE t (a int);'], 'a.sql')]),
    ).toBe(false)
  })
})

/** A dBase III table with one character field and one record. */
function dbfBytes(value: string): Uint8Array<ArrayBuffer> {
  const headerLength = 32 + 32 + 1
  const recordLength = 1 + 4
  const bytes = new Uint8Array(headerLength + recordLength + 1)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x03
  bytes[1] = 125
  bytes[2] = 10
  bytes[3] = 16
  view.setUint32(4, 1, true)
  view.setUint16(8, headerLength, true)
  view.setUint16(10, recordLength, true)
  bytes.set(
    Uint8Array.from('NAME', (c) => c.charCodeAt(0)),
    32,
  )
  bytes[32 + 11] = 'C'.charCodeAt(0)
  bytes[32 + 16] = 4
  bytes[32 + 32] = 0x0d
  bytes[headerLength] = 0x20
  bytes.set(
    Uint8Array.from(value.padEnd(4), (c) => c.charCodeAt(0)),
    headerLength + 1,
  )
  bytes[bytes.length - 1] = 0x1a
  return bytes
}

describe('dBase selections', () => {
  it('takes a dBase table for a database, not a dump', async () => {
    const table = new File([dbfBytes('anne')], 'CLIENTES.DBF')
    expect(await isDbfSelection([table])).toBe(true)
    expect(await isSqliteSelection([table])).toBe(true)
  })

  it('takes a memo file on its own for a dBase selection', async () => {
    const memo = new File([new Uint8Array(512)], 'CLIENTES.DBT')
    expect(await isDbfSelection([memo])).toBe(true)
    expect(await isSqliteSelection([memo])).toBe(true)
  })

  it('takes a table named something else by its header', async () => {
    const table = new File([dbfBytes('anne')], 'CLIENTES.001')
    expect(await isDbfSelection([table])).toBe(true)
  })

  it('leaves a dump alone', async () => {
    expect(
      await isDbfSelection([new File(['CREATE TABLE t (a int);'], 'a.sql')]),
    ).toBe(false)
  })

  it('reads each table with the memo file that belongs to it', async () => {
    const sources = await readDbfSelection([
      new File([new Uint8Array([7])], 'PETS.FPT'),
      new File([dbfBytes('cleo')], 'PETS.DBF'),
      new File([dbfBytes('anne')], 'PEOPLE.DBF'),
      new File([new Uint8Array(4)], 'INDPEO.cdx'),
    ])
    expect(sources.map((source) => source.name)).toEqual([
      'PEOPLE.DBF',
      'PETS.DBF',
    ])
    expect(sources[0]?.memo).toBeUndefined()
    expect(sources[1]?.memo).toEqual(Uint8Array.from([7]))
  })

  it('counts only the dBase files towards the size limit', () => {
    expect(
      dbfSelectionBytes([
        new File([new Uint8Array(10)], 'PETS.DBF'),
        new File([new Uint8Array(20)], 'PETS.FPT'),
        new File([new Uint8Array(40)], 'INDPET.cdx'),
      ]),
    ).toBe(30)
  })
})
