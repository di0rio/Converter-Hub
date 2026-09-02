import { zipSync, strToU8 } from 'fflate'
import type { SqlDump, ExtractionOptions } from '../types/index.js'
import type { TabularTable } from '../tabular/index.js'
import { extractDatabase } from '../extractor/index.js'
import { toTabular } from '../tabular/index.js'

export type ExportFormat = 'sql' | 'csv' | 'xlsx'

export interface ExportFile {
  name: string
  content: Uint8Array
}

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

// ---------------------------------------------------------------- CSV

/** RFC 4180: quote when the value contains a delimiter, quote or newline. */
function csvCell(value: string | null): string {
  if (value === null) return ''
  return /["\,\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value
}

export function toCsv(table: TabularTable): string {
  const lines = [table.columns.map(csvCell).join(',')]
  for (const row of table.rows) lines.push(row.map(csvCell).join(','))
  // Excel only reads UTF-8 CSV correctly when a byte order mark is present.
  return '﻿' + lines.join('\r\n') + '\r\n'
}

// --------------------------------------------------------------- XLSX

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0 forbids most control characters outright.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

/**
 * Excel worksheet names: at most 31 characters, none of : \ / ? * [ ],
 * not blank, and unique within the workbook.
 */
function sheetName(name: string, taken: Set<string>): string {
  let base = name.replace(/[:\\/?*[\]]/g, '_').slice(0, 31)
  if (base.trim().length === 0) base = 'Sheet'

  let candidate = base
  let suffix = 2
  while (taken.has(candidate.toLowerCase())) {
    const room = 31 - String(suffix).length - 1
    candidate = base.slice(0, room) + '_' + suffix
    suffix++
  }

  taken.add(candidate.toLowerCase())
  return candidate
}

function columnLetter(index: number): string {
  let out = ''
  let n = index
  while (n >= 0) {
    out = String.fromCharCode((n % 26) + 65) + out
    n = Math.floor(n / 26) - 1
  }
  return out
}

const NUMERIC = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/

function sheetXml(table: TabularTable): string {
  const allRows: (string | null)[][] = [table.columns, ...table.rows]

  const rows = allRows.map((row, rowIndex) => {
    const cells = row
      .map((value, colIndex) => {
        if (value === null || value === '') return ''
        const ref = columnLetter(colIndex) + (rowIndex + 1)
        // Leading zeros carry meaning in dumps (postcodes, ids) — keep them text.
        if (NUMERIC.test(value) && !/^-?0[0-9]/.test(value)) {
          return '<c r="' + ref + '"><v>' + value + '</v></c>'
        }
        return (
          '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
          xmlEscape(String(value)) +
          '</t></is></c>'
        )
      })
      .join('')

    return '<row r="' + (rowIndex + 1) + '">' + cells + '</row>'
  })

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>' + rows.join('') + '</sheetData></worksheet>'
  )
}

export function toXlsx(tables: TabularTable[]): Uint8Array {
  const taken = new Set<string>()
  const sheets = tables.map((table, index) => ({
    id: index + 1,
    name: sheetName(table.name, taken),
    xml: sheetXml(table),
  }))

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (s) =>
          '<Override PartName="/xl/worksheets/sheet' + s.id +
          '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      )
      .join('') +
    '</Types>'

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>'

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets
      .map(
        (s) =>
          '<sheet name="' + xmlEscape(s.name) + '" sheetId="' + s.id + '" r:id="rId' + s.id + '"/>',
      )
      .join('') +
    '</sheets></workbook>'

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (s) =>
          '<Relationship Id="rId' + s.id +
          '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"' +
          ' Target="worksheets/sheet' + s.id + '.xml"/>',
      )
      .join('') +
    '</Relationships>'

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
  }

  for (const sheet of sheets) {
    files['xl/worksheets/sheet' + sheet.id + '.xml'] = strToU8(sheet.xml)
  }

  return zipSync(files, { level: 6 })
}

// ---------------------------------------------------------------- ZIP

export function createZip(files: ExportFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const file of files) entries[file.name] = file.content
  return zipSync(entries, { level: 6 })
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
  if (!database) throw new Error('Selected database is not present in this dump.')

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
    files.push({ name: base + '.xlsx', content: toXlsx(selected.map(toTabular)) })
  }

  return {
    filename: base + '-export.zip',
    bytes: createZip(files),
    files: files.map((f) => f.name),
    tableCount: selected.length,
  }
}
