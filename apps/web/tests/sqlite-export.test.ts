import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import type { SqliteTable } from '@sql-extractor/core'
import { buildSqliteExport } from '@/lib/sqlite-export'

const table = (over: Partial<SqliteTable> = {}): SqliteTable => ({
  name: 'crew',
  createStatement: 'CREATE TABLE crew (id INTEGER PRIMARY KEY, name TEXT)',
  columns: [
    { name: 'id', declaredType: 'INTEGER', primaryKey: true, notNull: true },
    { name: 'name', declaredType: 'TEXT', primaryKey: false, notNull: false },
  ],
  rows: [
    [1, 'Ada'],
    [2, null],
  ],
  rowCount: 2,
  indexStatements: [],
  ...over,
})

const entries = (bytes: Uint8Array) => unzipSync(bytes)

describe('file names', () => {
  // Table names come from the user's database and end up as ZIP entry paths.
  it('never lets a table name become a path, or two tables share a file', () => {
    const names = ['../../etc/passwd', 'Users', 'users', 'a/b', 'a-b']
    const result = buildSqliteExport(
      'shop',
      names.map((name) => table({ name })),
      'csv',
    )

    expect(result.files.map((file) => file.name)).toEqual([
      'etc-passwd.csv',
      'Users.csv',
      'users_2.csv',
      'a-b.csv',
      'a-b_2.csv',
    ])
    expect(Object.keys(entries(result.bytes))).toHaveLength(5)
  })

  it('strips control characters and keeps unicode', () => {
    const result = buildSqliteExport(
      'shop',
      [table({ name: 'bad\u0000name' }), table({ name: 'usuários' })],
      'csv',
    )

    expect(result.files.map((file) => file.name)).toEqual([
      'badname.csv',
      'usuários.csv',
    ])
  })

  it('names a nameless table rather than writing a bare extension', () => {
    const result = buildSqliteExport('shop', [table({ name: '' })], 'csv')

    expect(result.files[0]?.name).toBe('table.csv')
  })
})

describe('buildSqliteExport', () => {
  it('writes one SQL document carrying the original schema', () => {
    const result = buildSqliteExport('shop', [table()], 'sql')
    const files = entries(result.bytes)
    expect(Object.keys(files)).toEqual(['shop.sql'])
    const sql = strFromU8(files['shop.sql'] as Uint8Array)
    expect(sql).toContain('CREATE TABLE crew (id INTEGER PRIMARY KEY')
    expect(sql).toContain("(1,'Ada')")
    expect(sql).toContain('(2,NULL)')
  })

  it('writes one CSV per table', () => {
    const result = buildSqliteExport(
      'shop',
      [table(), table({ name: 'ships', rows: [[9, 'Ember']] })],
      'csv',
    )
    expect(Object.keys(entries(result.bytes)).sort()).toEqual([
      'crew.csv',
      'ships.csv',
    ])
    expect(result.tableCount).toBe(2)
  })

  it('writes CSV with the chosen delimiter', () => {
    const result = buildSqliteExport('shop', [table()], 'csv', {
      delimiter: ';',
    })
    const csv = strFromU8(entries(result.bytes)['crew.csv'] as Uint8Array)

    expect(csv.replace(/^\ufeff/, '')).toBe('id;name\r\n1;Ada\r\n2;\r\n')
  })

  it('writes one workbook for every table', () => {
    const result = buildSqliteExport('shop', [table()], 'xlsx')
    expect(Object.keys(entries(result.bytes))).toEqual(['shop.xlsx'])
  })

  it.each(['json', 'jsonl', 'md'] as const)(
    'writes one %s per table',
    (format) => {
      const result = buildSqliteExport('shop', [table()], format)
      expect(Object.keys(entries(result.bytes))).toEqual([`crew.${format}`])
    },
  )

  it('writes JSON Lines as one record per row', () => {
    const result = buildSqliteExport('shop', [table()], 'jsonl')
    const text = strFromU8(entries(result.bytes)['crew.jsonl'] as Uint8Array)
    const records = text
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line))

    expect(records).toHaveLength(2)
    expect(records[0].name).toBe('Ada')
  })

  // The protection exists because a spreadsheet opens CSV cells as formulas.
  // Data arriving from SQLite is no more trustworthy than data from a sheet.
  it('keeps formula neutralisation for values out of SQLite', () => {
    const dangerous = table({ rows: [[1, '=SUM(A1:A9)']] })
    const result = buildSqliteExport('shop', [dangerous], 'csv')
    const csv = strFromU8(entries(result.bytes)['crew.csv'] as Uint8Array)
    expect(csv).not.toMatch(/(^|,)=SUM/m)
  })

  it('encodes a blob as base64 in text formats and as hex in SQL', () => {
    const withBlob = table({
      columns: [
        { name: 'id', declaredType: '', primaryKey: true, notNull: true },
        {
          name: 'avatar',
          declaredType: 'BLOB',
          primaryKey: false,
          notNull: false,
        },
      ],
      rows: [[1, new Uint8Array([0x00, 0xff])]],
    })

    const csv = strFromU8(
      entries(buildSqliteExport('shop', [withBlob], 'csv').bytes)[
        'crew.csv'
      ] as Uint8Array,
    )
    expect(csv).toContain('AP8=')

    const sql = strFromU8(
      entries(buildSqliteExport('shop', [withBlob], 'sql').bytes)[
        'shop.sql'
      ] as Uint8Array,
    )
    expect(sql).toContain("X'00ff'")
  })

  it('names the archive after the database', () => {
    expect(buildSqliteExport('bonfire', [table()], 'csv').filename).toBe(
      'bonfire.zip',
    )
  })
})
