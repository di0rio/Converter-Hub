import { strToU8 } from 'fflate'
import type { SqlDump, ExtractionOptions } from '../types/index.js'
import { extractDatabase } from '../extractor/index.js'
import { toTabular } from '../tabular/index.js'
import { createZip, toCsv, toXlsx, type ExportFile } from './writers.js'

export * from './writers.js'

export type ExportFormat = 'sql' | 'csv' | 'xlsx'

export interface ExportResult {
  filename: string
  bytes: Uint8Array
  files: string[]
  tableCount: number
}

/** Keep generated names safe as archive entries and as saved files. */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '')
  return cleaned.length > 0 ? cleaned.slice(0, 100) : 'unnamed'
}

// -------------------------------------------------------- orchestration

/**
 * Extract the selected database and tables and package them in the chosen
 * format as a ZIP archive.
 *
 * Everything here is a pure byte transformation: no filesystem, no network,
 * and the SQL is never executed.
 */
export function generateExport(
  dump: SqlDump,
  options: ExtractionOptions,
  format: ExportFormat,
): ExportResult {
  const database = dump.databases.find((d) => d.name === options.database)
  if (!database)
    throw new Error('Selected database is not present in this dump.')

  const selected =
    options.tables === 'all'
      ? database.tables
      : database.tables.filter((t) => options.tables.includes(t.name))

  if (selected.length === 0) throw new Error('No tables were selected.')

  const base = safeFileName(database.name)
  const files: ExportFile[] = []

  if (format === 'sql') {
    const result = extractDatabase(dump, options)
    files.push({ name: base + '.sql', content: strToU8(result.sql) })
  } else if (format === 'csv') {
    const taken = new Set<string>()
    for (const table of selected) {
      let name = safeFileName(table.name) + '.csv'
      let suffix = 2
      while (taken.has(name.toLowerCase())) {
        name = safeFileName(table.name) + '_' + suffix++ + '.csv'
      }
      taken.add(name.toLowerCase())
      files.push({ name, content: strToU8(toCsv(toTabular(table))) })
    }
  } else {
    files.push({
      name: base + '.xlsx',
      content: toXlsx(selected.map(toTabular)),
    })
  }

  return {
    filename: base + '-export.zip',
    bytes: createZip(files),
    files: files.map((f) => f.name),
    tableCount: selected.length,
  }
}
