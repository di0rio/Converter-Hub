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
