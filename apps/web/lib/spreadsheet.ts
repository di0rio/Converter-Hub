import { createZip, formatBytes, toCsv } from '@sql-extractor/core'
import type { ExportFile } from '@sql-extractor/core'
import type { WorkBook, WorkSheet } from 'xlsx'

/** What the export writes: one workbook per sheet, or one plain text table. */
export type ExportFormat = 'xlsx' | 'csv'

export interface SheetInfo {
  name: string
  /** Data rows: the used range without the header row that names the columns. */
  rows: number
  columns: number
  /** No used range at all, so nothing would be written for it. */
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
export const ACCEPTED_EXTENSIONS = ['.xlsx', '.xlsm', '.xls']

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

function describe(sheet: WorkSheet | undefined, name: string): SheetInfo {
  if (!sheet || !sheet['!ref']) {
    return { name, rows: 0, columns: 0, empty: true }
  }

  // Decoding the used range is cheaper than walking the cells, and it is the
  // same range Excel itself reports.
  const [start, end] = sheet['!ref'].split(':')
  const parse = (ref: string) => {
    const match = /^([A-Z]+)(\d+)$/.exec(ref)
    if (!match) return { col: 0, row: 0 }
    let col = 0
    for (const char of match[1]) col = col * 26 + (char.charCodeAt(0) - 64)
    return { col, row: Number(match[2]) }
  }

  const from = parse(start)
  const to = parse(end ?? start)
  const rows = Math.max(0, to.row - from.row + 1)
  // The first row of the range is the sheet's header — it names the columns in
  // the preview and in the CSV. Counting data rows rather than range rows is
  // what makes "5 rows" here mean the same thing it means in the SQL tool, and
  // agree with the five numbered rows the preview shows.
  const dataRows = Math.max(0, rows - 1)
  const columns = Math.max(0, to.col - from.col + 1)

  // "Empty" still means the sheet has no used range at all. A sheet holding
  // only a header is not empty — exporting it produces a real file with real
  // column names, which is a reasonable thing to ask for.
  return { name, rows: dataRows, columns, empty: rows === 0 || columns === 0 }
}

/** Read a spreadsheet file into its sheet list. Nothing leaves the browser. */
export async function readWorkbook(file: File): Promise<LoadedWorkbook> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })

  return {
    fileName: file.name,
    baseName: file.name.replace(/\.[^.]+$/, '') || 'workbook',
    sheets: workbook.SheetNames.map((name) =>
      describe(workbook.Sheets[name], name),
    ),
    workbook,
  }
}

/** Every row of a sheet as text, which is what both the preview and CSV take. */
async function readRows(
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

/** The first rows of a sheet, for the preview table. */
export function readPreview(
  workbook: WorkBook,
  sheetName: string,
  limit = 50,
): Promise<string[][]> {
  return readRows(workbook, sheetName, limit)
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
export async function buildArchive(
  loaded: LoadedWorkbook,
  sheetNames: string[],
  format: ExportFormat,
  /** Called after each sheet, so the UI can report real progress. */
  onProgress?: (done: number, total: number) => void,
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

    if (format === 'csv') {
      const rows = await readRows(loaded.workbook, name)
      // The first row is the header the sheet already has; the CSV writer
      // takes columns and rows apart, so it is split off rather than invented.
      const [header = [], ...body] = rows
      const csv = toCsv({ name, columns: header, rows: body })
      const entry = `${fileName}.csv`
      entries.push({ name: entry, content: encoder.encode(csv) })
      files.push(entry)
    } else {
      const single = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(single, sheet, toSheetName(name))
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
