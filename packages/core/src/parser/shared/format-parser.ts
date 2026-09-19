import type { DatabaseFormat } from '../../formats/index.js'
import type { SqlDump } from '../../types/index.js'

export interface DataBlock {
  columns: string[] | null
  rows: (string | null)[][]
}

export interface FormatParser {
  format: DatabaseFormat
  parse(sql: string): SqlDump
  readColumns(createStatement: string): string[]
  readDataBlock(statement: string): DataBlock
  countDataRows(statement: string): number
}
