import type { Table } from '../types/index.js'
import { getParser } from '../parser/index.js'

import type { TabularTable } from './columns.js'

export { normalizeColumns } from './columns.js'
export type { TabularTable } from './columns.js'

export function extractColumns(table: Table): string[] {
  return getParser(table.format).readColumns(table.createStatement)
}

export function countRows(table: Table): number {
  const parser = getParser(table.format)

  let total = 0
  for (const statement of table.dataStatements) {
    total += parser.countDataRows(statement)
  }
  return total
}

export function toTabular(table: Table): TabularTable {
  const parser = getParser(table.format)
  const columns = parser.readColumns(table.createStatement)
  const rows: (string | null)[][] = []

  let declaredColumns: string[] | null = null

  for (const statement of table.dataStatements) {
    const block = parser.readDataBlock(statement)
    if (block.columns && declaredColumns === null)
      declaredColumns = block.columns

    for (const values of block.rows) {
      if (block.columns && columns.length > 0) {
        const named = block.columns
        rows.push(
          columns.map((column) => {
            const index = named.indexOf(column)
            return index === -1 ? null : (values[index] ?? null)
          }),
        )
        continue
      }

      rows.push(values)
    }
  }

  if (columns.length === 0 && rows.length > 0) {
    const width = Math.max(...rows.map((row) => row.length))
    const headers =
      declaredColumns && declaredColumns.length === width
        ? declaredColumns
        : Array.from({ length: width }, (_, i) => `column_${i + 1}`)

    return { name: table.name, columns: headers, rows }
  }

  return { name: table.name, columns, rows }
}
