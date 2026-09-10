import { describe, it, expect } from 'vitest'
import {
  toCellText,
  toSqlLiteral,
  sqliteToTabular,
  sqliteToSql,
} from '../src/sqlite/index.js'
import type { SqliteTable } from '../src/sqlite/index.js'

/**
 * SQLite stores what it was given: five storage classes, no coercion, and no
 * date type. These cover the conversions where a careless reader would quietly
 * lose or invent data.
 */

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

  // SQLite has no literal for these, and writing one would not read back.
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
