import { describe, it, expect } from 'vitest'
import { parseDump } from '../src/parser/index.js'
import { countRows, toTabular } from '../src/tabular/index.js'
import type { Table } from '../src/types/index.js'

function tableFrom(sql: string, index = 0): Table {
  return parseDump(sql).databases[0].tables[index]
}

const CREATE = 'CREATE TABLE `t` (`id` int NOT NULL, `name` varchar(50));'

describe('countRows', () => {
  it('counts value tuples, not statements', () => {
    const table = tableFrom(CREATE + "INSERT INTO `t` VALUES (1,'a'),(2,'b'),(3,'c');")
    expect(table.dataStatements).toHaveLength(1)
    expect(countRows(table)).toBe(3)
  })

  it('sums rows across several INSERT statements', () => {
    const table = tableFrom(
      CREATE +
        "INSERT INTO `t` VALUES (1,'a'),(2,'b'),(3,'c');" +
        "INSERT INTO `t` VALUES (4,'d'),(5,'e');",
    )
    expect(table.dataStatements).toHaveLength(2)
    expect(countRows(table)).toBe(5)
  })

  it('counts rows in a multiline INSERT', () => {
    const table = tableFrom(
      [CREATE, 'INSERT INTO `t` VALUES', "(1,'a'),", "(2,'b'),", "(3,'d');"].join('\n'),
    )
    expect(countRows(table)).toBe(3)
  })

  it('returns zero for a table with no data', () => {
    expect(countRows(tableFrom(CREATE))).toBe(0)
  })

  it('does not count CREATE TABLE, comments or blank lines', () => {
    const table = tableFrom(
      [
        '-- a leading comment',
        '',
        CREATE,
        '-- another comment',
        "INSERT INTO `t` VALUES (1,'a');",
      ].join('\n'),
    )
    expect(countRows(table)).toBe(1)
  })

  it('is not fooled by commas or parentheses inside values', () => {
    const table = tableFrom(
      CREATE + "INSERT INTO `t` VALUES (1,'Smith, John (Jr.)'),(2,'a),(b');",
    )
    expect(countRows(table)).toBe(2)
  })

  it('agrees with the rows the viewer would render', () => {
    const table = tableFrom(
      CREATE + "INSERT INTO `t` VALUES (1,'a'),(2,'b');INSERT INTO `t` VALUES (3,'c');",
    )
    expect(countRows(table)).toBe(toTabular(table).rows.length)
  })
})

describe('viewer data', () => {
  const table = tableFrom(
    CREATE + "INSERT INTO `t` VALUES (1,'Ana'),(2,NULL);",
  )

  it('exposes column names', () => {
    expect(toTabular(table).columns).toEqual(['id', 'name'])
  })

  it('exposes row values with NULL preserved as absent', () => {
    expect(toTabular(table).rows).toEqual([
      ['1', 'Ana'],
      ['2', null],
    ])
  })

  it('describes an empty table without inventing rows', () => {
    const empty = toTabular(tableFrom(CREATE))
    expect(empty.columns).toEqual(['id', 'name'])
    expect(empty.rows).toEqual([])
  })
})
