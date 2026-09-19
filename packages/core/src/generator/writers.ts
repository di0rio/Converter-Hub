import { zipSync, strToU8 } from 'fflate'
import type { TabularTable } from '../tabular/columns.js'

export interface ExportFile {
  name: string
  content: Uint8Array
}

const RESERVED = /[\\/:*?"<>|]/g
const CONTROL = /[\x00-\x1F\x7F]/g

const EDGES = /^[.\-\s]+|[.\-\s]+$/g

export function toFileName(name: string, fallback: string): string {
  const cleaned = name
    .replace(RESERVED, '-')
    .replace(CONTROL, '')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(EDGES, '')
    .slice(0, 100)
    .replace(EDGES, '')

  return cleaned.length > 0 ? cleaned : fallback
}

export function uniqueName(base: string, taken: Set<string>): string {
  let candidate = base
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    candidate = `${base}_${n}`
  }
  taken.add(candidate.toLowerCase())
  return candidate
}

export type CsvDelimiter = ',' | ';' | '\t'

export type CsvOptions = {
  delimiter?: CsvDelimiter
}

export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value
}

function csvCell(value: string | null, delimiter: CsvDelimiter): string {
  if (value === null) return ''
  const safe = neutralizeFormula(value)
  return safe.includes(delimiter) || /["\r\n]/.test(safe)
    ? '"' + safe.replace(/"/g, '""') + '"'
    : safe
}

export function toCsv(
  table: TabularTable,
  { delimiter = ',' }: CsvOptions = {},
): string {
  const line = (cells: (string | null)[]) =>
    cells.map((cell) => csvCell(cell, delimiter)).join(delimiter)
  const lines = [line(table.columns)]
  for (const row of table.rows) lines.push(line(row))
  return '\ufeff' + lines.join('\r\n') + '\r\n'
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

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
        if (NUMERIC.test(value) && !/^-?0[0-9]/.test(value)) {
          return '<c r="' + ref + '"><v>' + value + '</v></c>'
        }
        return (
          '<c r="' +
          ref +
          '" t="inlineStr"><is><t xml:space="preserve">' +
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
    '<sheetData>' +
    rows.join('') +
    '</sheetData></worksheet>'
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
          '<Override PartName="/xl/worksheets/sheet' +
          s.id +
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
          '<sheet name="' +
          xmlEscape(s.name) +
          '" sheetId="' +
          s.id +
          '" r:id="rId' +
          s.id +
          '"/>',
      )
      .join('') +
    '</sheets></workbook>'

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (s) =>
          '<Relationship Id="rId' +
          s.id +
          '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"' +
          ' Target="worksheets/sheet' +
          s.id +
          '.xml"/>',
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

export function createZip(files: ExportFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const file of files) entries[file.name] = file.content
  return zipSync(entries, { level: 6 })
}
