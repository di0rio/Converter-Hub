import type { DatabaseFormat } from '../../formats/index.js'
import type { SqlDump } from '../../types/index.js'

/**
 * One row-carrying statement, decoded.
 *
 * `columns` is the column list the statement names — `INSERT INTO t (a, b)` or
 * `COPY t (a, b)`. It is `null` when the statement gives every column of the
 * table in declaration order and names none of them.
 */
export interface DataBlock {
  columns: string[] | null
  rows: (string | null)[][]
}

/**
 * Everything the rest of the application needs from a database format.
 *
 * Adding a format means writing one of these and registering it. No extractor,
 * generator or UI code changes, because nothing above this interface reads
 * dialect-specific SQL.
 */
export interface FormatParser {
  format: DatabaseFormat
  /** Structure walk: databases, tables and the raw statements that back them. */
  parse(sql: string): SqlDump
  /** Column names from a CREATE TABLE statement, in declaration order. */
  readColumns(createStatement: string): string[]
  /** Decode one row-carrying statement into cell values. */
  readDataBlock(statement: string): DataBlock
  /** Row count for one row-carrying statement, without decoding its values. */
  countDataRows(statement: string): number
}
