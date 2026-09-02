import type { Table } from '../types/index.js'
import { getParser } from '../parser/index.js'

export interface TabularTable {
  name: string
  columns: string[]
  rows: (string | null)[][]
}

/**
 * Column names a table declares, in declaration order.
 *
 * The dialect-specific reading is done by the table's own parser, so this works
 * the same for every supported format.
 */
export function extractColumns(table: Table): string[] {
  return getParser(table.format).readColumns(table.createStatement)
}

/**
 * Number of data rows a table holds.
 *
 * One multi-row INSERT counts as its rows rather than as one statement, and a
 * COPY block counts as its data lines. DDL and comments are not data and are
 * never counted.
 *
 * This skips value decoding, so it stays cheap enough to call for every table
 * in a dump.
 */
export function countRows(table: Table): number {
  const parser = getParser(table.format)

  let total = 0
  for (const statement of table.dataStatements) {
    total += parser.countDataRows(statement)
  }
  return total
}

/**
 * Flatten a parsed table into the columns and rows a CSV or spreadsheet needs.
 *
 * Only text already captured by the parser is read here, and nothing beyond
 * unescaping a literal is interpreted. The assembly is format-agnostic: which
 * engine wrote the dump changes how a statement is decoded, never how the rows
 * line up against the columns.
 */
export function toTabular(table: Table): TabularTable {
  const parser = getParser(table.format)
  const columns = parser.readColumns(table.createStatement)
  const rows: (string | null)[][] = []

  // Without a CREATE TABLE the only names available are the ones the data
  // statements list for themselves.
  let declaredColumns: string[] | null = null

  for (const statement of table.dataStatements) {
    const block = parser.readDataBlock(statement)
    if (block.columns && declaredColumns === null) declaredColumns = block.columns

    for (const values of block.rows) {
      // A statement that names its columns may list them in another order, or
      // leave some of the table's columns out entirely.
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

  // A dump with rows but no CREATE TABLE still deserves usable output.
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
