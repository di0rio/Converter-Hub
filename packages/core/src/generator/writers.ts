import { zipSync, strToU8 } from 'fflate'
import type { TabularTable } from '../tabular/columns.js'

/**
 * The writers every tool shares: CSV, XLSX, ZIP and safe file names.
 *
 * Nothing here knows about SQL dumps or their parsers, so a tool that only
 * writes files does not pull every dialect into its bundle.
 */

export interface ExportFile {
  name: string
  content: Uint8Array
}

const RESERVED = /[\\/:*?"<>|]/g
const CONTROL = /[\x00-\x1F\x7F]/g

/** Leading and trailing dots, dashes and spaces, which never carry meaning. */
const EDGES = /^[.\-\s]+|[.\-\s]+$/g

/**
 * A name taken from the user's file — a sheet, a table, a database — made safe
 * to name a saved file or a ZIP entry.
 *
 * The name is untrusted input for the archive it is about to name: the
 * separators that would let an entry escape its folder are replaced, leading
 * dots cannot produce a `..` entry or a hidden file, control characters are
 * stripped, and the length is capped. What survives is left alone — accents and
 * non-Latin scripts are legal in file names, and mangling them would only make
 * the output harder to recognise.
 */
export function toFileName(name: string, fallback: string): string {
  const cleaned = name
    .replace(RESERVED, '-')
    .replace(CONTROL, '')
    .replace(/\s+/g, ' ')
    // A run of separators reads as one, and a name made only of them collapses
    // to nothing and falls through to the fallback.
    .replace(/-{2,}/g, '-')
    .replace(EDGES, '')
    .slice(0, 100)
    // The cut can land on a separator, so tidy the new end as well.
    .replace(EDGES, '')

  return cleaned.length > 0 ? cleaned : fallback
}

/**
 * Two names can differ only by case ("Sales" and "sales"), or become equal
 * once cleaned ("a/b" and "a-b"), and either is one file on Windows and macOS.
 * Suffix the later ones so nothing is overwritten.
 */
export function uniqueName(base: string, taken: Set<string>): string {
  let candidate = base
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    candidate = `${base}_${n}`
  }
  taken.add(candidate.toLowerCase())
  return candidate
}

// ---------------------------------------------------------------- CSV

export type CsvDelimiter = ',' | ';' | '\t'

export type CsvOptions = {
  delimiter?: CsvDelimiter
}

/**
 * A value starting with = + - @ tab or CR is read as a formula when Excel or
 * Sheets opens the file. Prefix it with ' so it stays literal text.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value
}

/** RFC 4180: quote when the value contains the delimiter, a quote or a newline. */
function csvCell(value: string | null, delimiter: CsvDelimiter): string {
  if (value === null) return ''
  // Dump and spreadsheet content is untrusted and may carry a formula payload.
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
  // Excel only reads UTF-8 CSV correctly when a byte order mark is present.
  return '\ufeff' + lines.join('\r\n') + '\r\n'
}

// --------------------------------------------------------------- XLSX

function xmlEscape(value: string): string {
  return (
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // XML 1.0 forbids most control characters outright.
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  )
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

// ---------------------------------------------------------------- ZIP

export function createZip(files: ExportFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const file of files) entries[file.name] = file.content
  return zipSync(entries, { level: 6 })
}
