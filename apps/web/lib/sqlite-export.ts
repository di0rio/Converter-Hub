import {
  createZip,
  toCsv,
  toFileName,
  toXlsx,
  sqliteToSql,
  sqliteToRecords,
  sqliteToTabular,
  toJsonl,
  uniqueName,
} from '@sql-extractor/core'
import type {
  CsvDelimiter,
  ExportFile,
  SqliteTable,
  TabularTable,
} from '@sql-extractor/core'
import { toMarkdown } from '@/lib/sheet-writers'

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

function tabularise(tables: readonly SqliteTable[]): TabularTable[] {
  return tables.map(sqliteToTabular)
}

export function buildSqliteExport(
  databaseName: string,
  tables: readonly SqliteTable[],
  format: SqliteExportFormat,
  { delimiter = ',' }: SqliteExportOptions = {},
): SqliteExportResult {
  const files: ExportFile[] = []
  const base = toFileName(databaseName, 'database')
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
      // JSON keeps the database types (null, numbers); the other text
      // formats are cells of text.
      const content =
        format === 'csv'
          ? toCsv(sqliteToTabular(table), { delimiter })
          : format === 'json'
            ? JSON.stringify(sqliteToRecords(table), null, 2)
            : format === 'jsonl'
              ? toJsonl(sqliteToRecords(table))
              : toMarkdown(sqliteToTabular(table))
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
