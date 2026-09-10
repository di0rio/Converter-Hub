import {
  createZip,
  formatBytes,
  toCsv,
  toSqlInserts,
} from '@sql-extractor/core'
import type { CsvDelimiter, ExportFile } from '@sql-extractor/core'
import type { CellObject, WorkBook, WorkSheet } from 'xlsx'
import { toJson, toMarkdown } from '@/lib/sheet-writers'

/** What the export writes for each sheet. The id is also the file extension. */
export type ExportFormat = 'xlsx' | 'csv' | 'json' | 'md' | 'sql'

export interface SheetInfo {
  name: string
  /** Data rows that actually hold something, header row excluded. */
  rows: number
  /** Index of the right-most column holding a value. */
  columns: number
  /** Not a single cell with a value, so nothing would be written for it. */
  empty: boolean
}

export interface LoadedWorkbook {
  fileName: string
  /** File name without its extension, used to name the archive. */
  baseName: string
  sheets: SheetInfo[]
  workbook: WorkBook
}

export interface ArchiveResult {
  filename: string
  bytes: Uint8Array
  /** Names of the files inside the archive, in the order they were written. */
  files: string[]
}

/** The file extensions this tool reads. */
export const ACCEPTED_EXTENSIONS = [
  '.xlsx',
  '.xlsm',
  '.xls',
  '.xlsb',
  '.ods',
  '.csv',
  '.tsv',
]

/** Plain-text tables, read as UTF-8 text rather than as bytes. */
const TEXT_EXTENSIONS = ['.csv', '.tsv']

/** Formats stored as a ZIP archive, which always starts with "PK\x03\x04". */
const ZIP_EXTENSIONS = ['.xlsx', '.xlsm', '.xlsb', '.ods']

type SheetJS = typeof import('xlsx')

/**
 * How large a workbook this tool will accept.
 *
 * A spreadsheet is a compressed archive, and reading it inflates far past its
 * size on disk: every cell becomes an object, and the split then holds a second
 * copy of each selected sheet while the ZIP is written. The ceiling sits well
 * below the SQL side's because a 100 MB workbook already costs more memory than
 * a 250 MB dump does.
 */
export const MAX_WORKBOOK_BYTES = 100 * 1024 * 1024

export function isOversizedWorkbook(bytes: number): boolean {
  return bytes > MAX_WORKBOOK_BYTES
}

/** Names both sizes so the gap is obvious, and nothing from the file itself. */
export function oversizedWorkbookMessage(bytes: number): string {
  return `That file is ${formatBytes(bytes)}. The largest spreadsheet this tool reads is ${formatBytes(MAX_WORKBOOK_BYTES)}.`
}

/**
 * Excel accepts sheet names that a file system does not, so the reserved
 * characters are replaced rather than dropped: "Jan/Feb" would otherwise
 * collapse into a path separator.
 *
 * The name comes out of the user's file, so it is treated as untrusted input
 * for the archive it is about to name: the separators that would let a ZIP
 * entry escape its own folder are gone, leading dots cannot produce a `..`
 * entry or a hidden file, control characters are stripped, and the length is
 * capped so a pathological name cannot produce an unopenable archive. What
 * survives is left alone — accents and non-Latin scripts are legal in file
 * names, and mangling them would only make the output harder to recognise.
 */
const RESERVED = /[\\/:*?"<>|]/g
const CONTROL = /[\x00-\x1F\x7F]/g

/** Leading and trailing dots, dashes and spaces, which never carry meaning. */
const EDGES = /^[.\-\s]+|[.\-\s]+$/g

export function toFileName(sheetName: string): string {
  const cleaned = sheetName
    .replace(RESERVED, '-')
    .replace(CONTROL, '')
    .replace(/\s+/g, ' ')
    // A run of separators reads as one. This also means a name made only of
    // them collapses to nothing, and falls through to the default below.
    .replace(/-{2,}/g, '-')
    // A leading dot would hide the file, and a bare ".." would name a parent
    // directory rather than a sheet.
    .replace(EDGES, '')
    .slice(0, 100)
    // The cut can land on a separator, so tidy the new end as well.
    .replace(EDGES, '')

  return cleaned.length > 0 ? cleaned : 'sheet'
}

/**
 * A tab name Excel will accept: at most 31 characters, none of : \ / ? * [ ],
 * and not blank.
 *
 * Excel enforces these when you type a name, but a file written by something
 * else need not have gone through Excel — and handing such a name back to the
 * writer throws, which would fail the whole split over one sheet. The file
 * name keeps the original; only the tab inside the new workbook is adjusted.
 */
function toSheetName(name: string): string {
  const cleaned = name
    .replace(/[:\\/?*[\]]/g, '_')
    .replace(CONTROL, '')
    .slice(0, 31)
    .trim()

  return cleaned.length > 0 ? cleaned : 'Sheet'
}

/**
 * Two sheets can differ only by case ("Sales" and "sales"), which is the same
 * file name on Windows and macOS. Suffix the later ones so nothing is lost.
 */
function uniqueName(base: string, taken: Set<string>): string {
  let candidate = base
  let n = 1
  while (taken.has(candidate.toLowerCase())) {
    n += 1
    candidate = `${base}_${n}`
  }
  taken.add(candidate.toLowerCase())
  return candidate
}

const CELL_REF = /^([A-Z]+)(\d+)$/

/**
 * What a sheet actually holds.
 *
 * The used range (`!ref`) is not the answer. Excel grows it to cover anything
 * that was ever touched — a fill colour dragged down a column, a deleted block,
 * a stray border — so a sheet with fifty rows of data routinely reports a range
 * of ten thousand. Reading the range gave a count that matched nothing: not the
 * preview, not the exported file, not what the user sees in Excel.
 *
 * So the cells are walked instead. A row counts when it holds at least one cell
 * with a value, which is the same rule the export applies when it drops blank
 * rows — the number here and the number of rows in the file that comes out are
 * now the same number, by construction.
 */
function describe(sheet: WorkSheet | undefined, name: string): SheetInfo {
  if (!sheet) return { name, rows: 0, columns: 0, empty: true }

  const rows = new Set<number>()
  let columns = 0

  for (const ref in sheet) {
    // Keys beginning with "!" are metadata (`!ref`, `!merges`), not cells.
    if (ref.charCodeAt(0) === 33) continue

    const cell = sheet[ref]
    // `z` is the blank cell type; a cell can also carry formatting and no
    // value at all. Neither is data, and neither survives into the export.
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

  // The first row that holds anything is the header — it names the columns in
  // the preview and in the CSV. Counting data rows rather than every row is
  // what makes "5 rows" here mean what it means in the SQL tool, and agree
  // with the five numbered rows the preview shows.
  return {
    name,
    rows: Math.max(0, rows.size - 1),
    columns,
    // A sheet holding only a header is not empty: exporting it produces a real
    // file with real column names, which is a reasonable thing to ask for.
    empty: rows.size === 0,
  }
}

/**
 * A CSV or TSV, read as UTF-8 text so accents survive, with every value kept
 * as the text it is: "007" keeps its zero and "1.10" stays "1.10".
 *
 * SheetJS reads almost anything as a text table, so two cheap checks refuse
 * what is plainly not one. A NUL character means the file is binary, and an
 * odd number of quotes means one never closed — SheetJS would otherwise
 * swallow the rest of the file into a single cell.
 */
function readTextTable(XLSX: SheetJS, text: string, name: string): WorkBook {
  const table = text.replace(/^\ufeff/, '')
  const quotes = table.match(/"/g)?.length ?? 0
  if (table.includes('\0') || quotes % 2 === 1) {
    throw new Error('Not a readable text table.')
  }

  const workbook = XLSX.read(table, { type: 'string', raw: true })
  // A text table has one sheet, and "Sheet1" says nothing about it.
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  return { ...workbook, SheetNames: [name], Sheets: { [name]: sheet } }
}

/**
 * A workbook stored as bytes. A ZIP-based format that does not start like a
 * ZIP is some other file renamed, which SheetJS would read as a text table
 * rather than reject.
 */
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

/** Read a spreadsheet file into its sheet list. Nothing leaves the browser. */
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

/**
 * Every row of a sheet as text, which is what both the viewer and the CSV
 * writer take. Blank rows are dropped, so the count matches what `describe`
 * reports and what the exported file holds.
 */
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

/**
 * Write one file per selected sheet into a ZIP.
 *
 * A ZIP rather than separate downloads: a browser blocks the second and later
 * downloads of a burst, so ten sheets would silently arrive as one file.
 *
 * The archive is written by the same ZIP writer the SQL tool uses, and CSV by
 * the same CSV writer — so a spreadsheet split and a dump extraction produce
 * files of the same shape, including the escaping that keeps a cell beginning
 * with `=` from being read back as a formula by whatever opens it next.
 */
/** A string literal inside a formula, where "!" and "[" are only text. */
const STRING_LITERAL = /"(?:[^"]|"")*"/g

/** A sheet named in a reference: quoted ('It''s here'!A1) or bare (Sales!A1). */
const SHEET_REFERENCE = /(?:'((?:[^']|'')+)'|([^\s'!"(),;=+\-*/&^<>:%{}]+))!/g

/**
 * Defined names belong to the source workbook and are not copied into the one
 * a sheet is written to, so a formula using one would open as #NAME?.
 */
function definedNames(workbook: WorkBook): RegExp | null {
  const names = (workbook.Workbook?.Names ?? [])
    .map((entry) => entry.Name)
    .filter((name) => name && !name.startsWith('_xlnm.'))
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  if (names.length === 0) return null
  return new RegExp(`(?<![\\w.])(?:${names.join('|')})(?![\\w.(])`, 'i')
}

/**
 * Whether a formula reads something a file holding only this sheet will not
 * have: another sheet, another workbook or table (`[1]Book!A1`, `Table1[Col]`)
 * or a defined name.
 */
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
    // Naming its own sheet is fine, as long as the tab keeps that name.
    if (referenced !== sheetName || toSheetName(sheetName) !== sheetName) {
      return true
    }
  }
  return false
}

/**
 * The sheet as it should be written on its own.
 *
 * A formula reading outside the sheet would open as #REF! or #NAME? in a file
 * that holds nothing else, so it is replaced by the value Excel cached next to
 * it. Formulas that only read this sheet stay formulas. The loaded workbook is
 * never modified: changed cells go into a copy of the sheet.
 */
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
  /** Read only when writing CSV. */
  delimiter?: CsvDelimiter
  /** Called after each sheet, so the UI can report real progress. */
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
      // The first row is the header the sheet already has; the writers take
      // columns and rows apart, so it is split off rather than invented.
      const [header = [], ...body] = rows
      const table = { name, columns: header, rows: body }
      const text =
        format === 'csv'
          ? toCsv(table, { delimiter })
          : format === 'json'
            ? toJson(table)
            : format === 'sql'
              ? // The table is named after the sheet, not after the archive
                // entry: a file name has to survive a file system, a table
                // name only has to survive being quoted.
                toSqlInserts(table, { tableName: name })
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
    // Writing a sheet blocks the main thread, so yield between them. Without
    // this the count would reach the end before the browser painted any of it,
    // and the progress would read as a single jump from nothing to done.
    if (onProgress) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return {
    filename: `${toFileName(loaded.baseName)}_sheets.zip`,
    bytes: createZip(entries),
    files,
  }
}
