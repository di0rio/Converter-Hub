import {
  createZip,
  toCsv,
  toFileName,
  toXlsx,
  sqliteToSql,
  sqliteToTabular,
  tableToRecords,
  toJsonl,
  uniqueName,
} from '@sql-extractor/core'
import type {
  CsvDelimiter,
  ExportFile,
  SqliteTable,
  TabularTable,
} from '@sql-extractor/core'
import { toJson, toMarkdown } from '@/lib/sheet-writers'

/**
 * Turning a SQLite database into the files the Hub already knows how to write.
 *
 * Every writer here is the one the other tools use. A SQLite table becomes a
 * `TabularTable` and takes the same path a spreadsheet sheet does, so CSV
 * quoting, formula neutralisation and the XLSX layout stay identical across
 * tools rather than being reimplemented per source.
 *
 * SQL is the exception, and deliberately so: a spreadsheet has no schema and
 * has one invented for it, while SQLite already stored a real one. That export
 * carries the original DDL instead of a flattened guess.
 */

export type SqliteExportFormat =
  | 'sql'
  | 'csv'
  | 'xlsx'
  | 'json'
  | 'jsonl'
  | 'md'

export interface SqliteExportOptions {
  delimiter?: CsvDelimiter
}

export interface SqliteExportResult {
  filename: string
  files: ExportFile[]
  tableCount: number
  bytes: Uint8Array
}

const encoder = new TextEncoder()

/** Every selected table, in the shape the text writers take. */
function tabularise(tables: readonly SqliteTable[]): TabularTable[] {
  return tables.map(sqliteToTabular)
}

/**
 * Build the archive for one export.
 *
 * SQL and XLSX are single documents covering every table; CSV, JSON and
 * Markdown are one file per table, which is the split the spreadsheet tool
 * already established. Everything is packed into a ZIP so the shape of the
 * download does not change with the format.
 */
export function buildSqliteExport(
  databaseName: string,
  tables: readonly SqliteTable[],
  format: SqliteExportFormat,
  { delimiter = ',' }: SqliteExportOptions = {},
): SqliteExportResult {
  const files: ExportFile[] = []
  const base = toFileName(databaseName, 'database')
  // Table names are untrusted: they become ZIP entries, and two can collide
  // once cleaned or when they differ only by case.
  const taken = new Set<string>()

  if (format === 'sql') {
    files.push({
      name: `${base}.sql`,
      content: encoder.encode(sqliteToSql(tables)),
    })
  } else if (format === 'xlsx') {
    files.push({
      name: `${base}.xlsx`,
      content: toXlsx(tabularise(tables)),
    })
  } else {
    for (const table of tables) {
      const tabular = sqliteToTabular(table)
      const content =
        format === 'csv'
          ? toCsv(tabular, { delimiter })
          : format === 'json'
            ? toJson(tabular)
            : format === 'jsonl'
              ? toJsonl(tableToRecords(tabular))
              : toMarkdown(tabular)
      files.push({
        name: `${uniqueName(toFileName(table.name, 'table'), taken)}.${format}`,
        content: encoder.encode(content),
      })
    }
  }

  return {
    filename: `${base}.zip`,
    files,
    tableCount: tables.length,
    bytes: createZip(files),
  }
}
