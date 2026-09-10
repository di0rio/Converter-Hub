import { describe, it, expect } from 'vitest'
import { SqliteReadError } from '@sql-extractor/core'
import { groupSqliteFiles } from '@/lib/sqlite-files'

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

  // The case that would silently report one database's rows as another's.
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
