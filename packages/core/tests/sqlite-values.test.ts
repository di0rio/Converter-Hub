import { describe, it, expect } from 'vitest'
import {
  toCellText,
  toJsonValue,
  toSqlLiteral,
  sqliteToRecords,
  sqliteToTabular,
  sqliteToSql,
} from '../src/sqlite/index.js'
import type { SqliteTable } from '../src/sqlite/index.js'

describe('toCellText', () => {
  it('keeps NULL as null rather than as a word', () => {
    expect(toCellText(null)).toBeNull()
  })

  it('keeps an empty string distinct from NULL', () => {
    expect(toCellText('')).toBe('')
  })

  it('writes integers and reals in their own notation', () => {
    expect(toCellText(42)).toBe('42')
    expect(toCellText(-1.5)).toBe('-1.5')
    expect(toCellText(0)).toBe('0')
  })

  it('keeps a big integer exact instead of rounding it through a float', () => {
    expect(toCellText(9007199254740993n)).toBe('9007199254740993')
  })

  it('encodes a blob as base64', () => {
    expect(toCellText(new Uint8Array([0x00, 0xff, 0x10]))).toBe('AP8Q')
  })

  it('leaves text that looks like a number or a date untouched', () => {
    expect(toCellText('007')).toBe('007')
    expect(toCellText('2024-01-01')).toBe('2024-01-01')
    expect(toCellText('1700000000')).toBe('1700000000')
  })
})

describe('toSqlLiteral', () => {
  it('writes NULL unquoted', () => {
    expect(toSqlLiteral(null)).toBe('NULL')
  })

  it('doubles an embedded quote so a value cannot become syntax', () => {
    expect(toSqlLiteral("'); DROP TABLE t; --")).toBe("'''); DROP TABLE t; --'")
  })

  it('writes a blob in the hex form SQLite reads back', () => {
    expect(toSqlLiteral(new Uint8Array([0x00, 0xff, 0x10]))).toBe("X'00ff10'")
  })

  it('writes numbers unquoted', () => {
    expect(toSqlLiteral(42)).toBe('42')
    expect(toSqlLiteral(1.5)).toBe('1.5')
  })

  it('writes a non-finite number as NULL', () => {
    expect(toSqlLiteral(Number.POSITIVE_INFINITY)).toBe('NULL')
    expect(toSqlLiteral(Number.NaN)).toBe('NULL')
  })

  it('keeps an empty string as an empty string, not NULL', () => {
    expect(toSqlLiteral('')).toBe("''")
  })
})

const table: SqliteTable = {
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
  indexStatements: ['CREATE INDEX crew_name ON crew (name)'],
}

describe('sqliteToTabular', () => {
  it('carries column names and rows into the shape every writer takes', () => {
    expect(sqliteToTabular(table)).toEqual({
      name: 'crew',
      columns: ['id', 'name'],
      rows: [
        ['1', 'Ada'],
        ['2', null],
      ],
    })
  })

  it('renames a duplicated column so writers stay unambiguous', () => {
    const clashing: SqliteTable = {
      ...table,
      columns: [
        { name: 'a', declaredType: '', primaryKey: false, notNull: false },
        { name: 'a', declaredType: '', primaryKey: false, notNull: false },
      ],
      rows: [[1, 2]],
    }
    expect(sqliteToTabular(clashing).columns).toEqual(['a', 'a_2'])
  })
})

describe('toJsonValue', () => {
  it('keeps NULL as null, not an empty string', () => {
    expect(toJsonValue(null)).toBeNull()
  })

  it('keeps integers and floats as numbers', () => {
    expect(toJsonValue(967)).toBe(967)
    expect(toJsonValue(-1.5)).toBe(-1.5)
    expect(toJsonValue(0)).toBe(0)
  })

  it('writes a bigint as a decimal string so no digit is lost', () => {
    expect(toJsonValue(9007199254740993n)).toBe('9007199254740993')
    expect(toJsonValue(-9223372036854775808n)).toBe('-9223372036854775808')
  })

  it('writes bytes as base64', () => {
    expect(toJsonValue(new Uint8Array([0x00, 0xff, 0x10]))).toBe('AP8Q')
  })

  it('writes a non-finite number as null', () => {
    expect(toJsonValue(Number.NaN)).toBeNull()
    expect(toJsonValue(Number.NEGATIVE_INFINITY)).toBeNull()
  })

  it('leaves text alone, including text that looks like a number', () => {
    expect(toJsonValue('')).toBe('')
    expect(toJsonValue('007')).toBe('007')
  })
})

describe('sqliteToRecords', () => {
  it('keys each row by column and keeps the value types', () => {
    expect(sqliteToRecords(table)).toEqual([
      { id: 1, name: 'Ada' },
      { id: 2, name: null },
    ])
  })

  it('round-trips through JSON with null, number, bigint and bytes', () => {
    const mixed: SqliteTable = {
      ...table,
      columns: ['n', 'i', 'f', 'big', 'blob'].map((name) => ({
        name,
        declaredType: '',
        primaryKey: false,
        notNull: false,
      })),
      rows: [[null, 967, 2.5, 2n ** 63n - 1n, new Uint8Array([1, 2, 3])]],
    }
    expect(JSON.parse(JSON.stringify(sqliteToRecords(mixed)))).toEqual([
      { n: null, i: 967, f: 2.5, big: '9223372036854775807', blob: 'AQID' },
    ])
  })

  it('writes a __proto__ column as an ordinary key', () => {
    const risky: SqliteTable = {
      ...table,
      columns: [
        {
          name: '__proto__',
          declaredType: '',
          primaryKey: false,
          notNull: false,
        },
      ],
      rows: [[1]],
    }
    expect(JSON.stringify(sqliteToRecords(risky))).toBe('[{"__proto__":1}]')
    expect(Object.getPrototypeOf(sqliteToRecords(risky)[0])).toBe(
      Object.prototype,
    )
  })

  it('names extra cells and fills a short row with null', () => {
    const ragged: SqliteTable = {
      ...table,
      rows: [[1], [2, 'Bo', 'extra']],
    }
    expect(sqliteToRecords(ragged)).toEqual([
      { id: 1, name: null, column_3: null },
      { id: 2, name: 'Bo', column_3: 'extra' },
    ])
  })
})

describe('sqliteToSql', () => {
  it('reuses the schema SQLite already stored rather than inventing one', () => {
    const sql = sqliteToSql([table])
    expect(sql).toContain(
      'CREATE TABLE crew (id INTEGER PRIMARY KEY, name TEXT);',
    )
    expect(sql).toContain('CREATE INDEX crew_name ON crew (name);')
  })

  it('writes rows as INSERTs that name their columns', () => {
    const sql = sqliteToSql([table])
    expect(sql).toContain('INSERT INTO "crew" ("id","name") VALUES')
    expect(sql).toContain("(1,'Ada')")
    expect(sql).toContain('(2,NULL)')
  })

  it('produces a script for a table with no rows', () => {
    const empty: SqliteTable = { ...table, rows: [], rowCount: 0 }
    const sql = sqliteToSql([empty])
    expect(sql).toContain('CREATE TABLE crew')
    expect(sql).not.toContain('INSERT INTO')
  })
})
