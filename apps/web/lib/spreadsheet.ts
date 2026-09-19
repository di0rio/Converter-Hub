import {
  createZip,
  formatBytes,
  toCsv,
  toFileName as safeName,
  toSqlInserts,
  uniqueName,
} from '@sql-extractor/core'
import type { CsvDelimiter, ExportFile } from '@sql-extractor/core'
import type { CellObject, WorkBook, WorkSheet } from 'xlsx'
import { toJson, toMarkdown } from '@/lib/sheet-writers'

export type ExportFormat = 'xlsx' | 'csv' | 'json' | 'md' | 'sql'

export interface SheetInfo {
  name: string
  rows: number
  columns: number
  empty: boolean
}

export interface LoadedWorkbook {
  fileName: string
  baseName: string
  sheets: SheetInfo[]
  workbook: WorkBook
}

export interface ArchiveResult {
  filename: string
  bytes: Uint8Array
  files: string[]
}

export const ACCEPTED_EXTENSIONS = [
  '.xlsx',
  '.xlsm',
  '.xls',
  '.xlsb',
  '.ods',
  '.csv',
  '.tsv',
]

const TEXT_EXTENSIONS = ['.csv', '.tsv']

const ZIP_EXTENSIONS = ['.xlsx', '.xlsm', '.xlsb', '.ods']

type SheetJS = typeof import('xlsx')

export const MAX_WORKBOOK_BYTES = 100 * 1024 * 1024

export function isOversizedWorkbook(bytes: number): boolean {
  return bytes > MAX_WORKBOOK_BYTES
}

export function oversizedWorkbookMessage(bytes: number): string {
  return `That file is ${formatBytes(bytes)}. The largest spreadsheet this tool reads is ${formatBytes(MAX_WORKBOOK_BYTES)}.`
}

const CONTROL = /[\x00-\x1F\x7F]/g

export function toFileName(sheetName: string): string {
  return safeName(sheetName, 'sheet')
}

function toSheetName(name: string): string {
  const cleaned = name
    .replace(/[:\\/?*[\]]/g, '_')
    .replace(CONTROL, '')
    .slice(0, 31)
    .trim()

  return cleaned.length > 0 ? cleaned : 'Sheet'
}

const CELL_REF = /^([A-Z]+)(\d+)$/

function describe(sheet: WorkSheet | undefined, name: string): SheetInfo {
  if (!sheet) return { name, rows: 0, columns: 0, empty: true }

  const rows = new Set<number>()
  let columns = 0

  for (const ref in sheet) {
    if (ref.charCodeAt(0) === 33) continue

    const cell = sheet[ref]
    if (!cell || cell.t === 'z' || cell.v === undefined || cell.v === '') {
      continue
    }

    const match = CELL_REF.exec(ref)
    if (!match) continue

    rows.add(Number(match[2]))

    let column = 0
    for (const char of match[1])
      column = column * 26 + (char.charCodeAt(0) - 64)
    if (column > columns) columns = column
  }

  return {
    name,
    rows: Math.max(0, rows.size - 1),
    columns,
    empty: rows.size === 0,
  }
}

function readTextTable(XLSX: SheetJS, text: string, name: string): WorkBook {
  const table = text.replace(/^\ufeff/, '')
  const quotes = table.match(/"/g)?.length ?? 0
  if (table.includes('\0') || quotes % 2 === 1) {
    throw new Error('Not a readable text table.')
  }

  const workbook = XLSX.read(table, { type: 'string', raw: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  return { ...workbook, SheetNames: [name], Sheets: { [name]: sheet } }
}

function readBinaryWorkbook(
  XLSX: SheetJS,
  buffer: ArrayBuffer,
  extension: string,
): WorkBook {
  const bytes = new Uint8Array(buffer)
  const zip =
    bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4
  if (ZIP_EXTENSIONS.includes(extension) && !zip) {
    throw new Error('Not the format its extension names.')
  }

  return XLSX.read(bytes, { type: 'array', cellDates: true })
}

export async function readWorkbook(file: File): Promise<LoadedWorkbook> {
  const XLSX = await import('xlsx')
  const extension = /\.[^.]+$/.exec(file.name.toLowerCase())?.[0] ?? ''
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'workbook'
  const workbook = TEXT_EXTENSIONS.includes(extension)
    ? readTextTable(XLSX, await file.text(), baseName)
    : readBinaryWorkbook(XLSX, await file.arrayBuffer(), extension)

  return {
    fileName: file.name,
    baseName,
    sheets: workbook.SheetNames.map((name) =>
      describe(workbook.Sheets[name], name),
    ),
    workbook,
  }
}

export async function readSheetRows(
  workbook: WorkBook,
  sheetName: string,
  limit?: number,
): Promise<string[][]> {
  const XLSX = await import('xlsx')
  const sheet = workbook.Sheets[sheetName]
  if (!sheet || !sheet['!ref']) return []

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    raw: false,
    defval: '',
  })

  const scoped = limit == null ? rows : rows.slice(0, limit)
  return scoped.map((row) => row.map((cell) => String(cell ?? '')))
}

const STRING_LITERAL = /"(?:[^"]|"")*"/g

const SHEET_REFERENCE = /(?:'((?:[^']|'')+)'|([^\s'!"(),;=+\-*/&^<>:%{}]+))!/g

function definedNames(workbook: WorkBook): RegExp | null {
  const names = (workbook.Workbook?.Names ?? [])
    .map((entry) => entry.Name)
    .filter((name) => name && !name.startsWith('_xlnm.'))
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  if (names.length === 0) return null
  return new RegExp(`(?<![\\w.])(?:${names.join('|')})(?![\\w.(])`, 'i')
}

function readsOutside(
  formula: string,
  sheetName: string,
  names: RegExp | null,
): boolean {
  const code = formula.replace(STRING_LITERAL, '""')
  if (code.includes('[')) return true
  if (names?.test(code)) return true

  for (const [, quoted, bare] of code.matchAll(SHEET_REFERENCE)) {
    const referenced = quoted === undefined ? bare : quoted.replace(/''/g, "'")
    if (referenced !== sheetName || toSheetName(sheetName) !== sheetName) {
      return true
    }
  }
  return false
}

function standalone(workbook: WorkBook, sheetName: string): WorkSheet {
  const sheet = workbook.Sheets[sheetName]
  const names = definedNames(workbook)
  let copy: WorkSheet | null = null

  for (const ref in sheet) {
    if (ref.charCodeAt(0) === 33) continue
    const cell = sheet[ref] as CellObject
    if (!cell?.f || !readsOutside(cell.f, sheetName, names)) continue

    const value: CellObject = { ...cell }
    delete value.f
    delete value.F
    copy ??= { ...sheet }
    copy[ref] = value
  }

  return copy ?? sheet
}

export type ArchiveOptions = {
  delimiter?: CsvDelimiter
  onProgress?: (done: number, total: number) => void
}

export async function buildArchive(
  loaded: LoadedWorkbook,
  sheetNames: string[],
  format: ExportFormat,
  { delimiter, onProgress }: ArchiveOptions = {},
): Promise<ArchiveResult> {
  const XLSX = await import('xlsx')

  const encoder = new TextEncoder()
  const taken = new Set<string>()
  const entries: ExportFile[] = []
  const files: string[] = []

  for (const name of sheetNames) {
    const sheet = loaded.workbook.Sheets[name]
    if (!sheet) continue

    const fileName = uniqueName(toFileName(name), taken)

    if (format !== 'xlsx') {
      const rows = await readSheetRows(loaded.workbook, name)
      const [header = [], ...body] = rows
      const table = { name, columns: header, rows: body }
      const text =
        format === 'csv'
          ? toCsv(table, { delimiter })
          : format === 'json'
            ? toJson(table)
            : format === 'sql'
              ? toSqlInserts(table, { tableName: name })
              : toMarkdown(table)
      const entry = `${fileName}.${format}`
      entries.push({ name: entry, content: encoder.encode(text) })
      files.push(entry)
    } else {
      const single = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(
        single,
        standalone(loaded.workbook, name),
        toSheetName(name),
      )
      const entry = `${fileName}.xlsx`
      entries.push({
        name: entry,
        content: new Uint8Array(
          XLSX.write(single, { bookType: 'xlsx', type: 'array' }),
        ),
      })
      files.push(entry)
    }

    onProgress?.(files.length, sheetNames.length)
    if (onProgress) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return {
    filename: `${toFileName(loaded.baseName)}_sheets.zip`,
    bytes: createZip(entries),
    files,
  }
}
