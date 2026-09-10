import { normalizeColumns, type TabularTable } from '../tabular/columns.js'

/**
 * Structured data — JSON, JSON Lines — and the one gate that decides whether
 * it can become a table.
 *
 * Every tabular writer takes a `TabularTable`, so this is where JSON joins
 * them. What it will not do is invent a table: a record whose field is itself
 * an object or a list has no single cell to put it in, and flattening it
 * would pick one of several defensible shapes on the user's behalf.
 */

/**
 * Thrown when a file is not the data it claims to be.
 *
 * The message is safe to show. It names the problem and, for JSON Lines, the
 * line — never the content, which can be anything the user's file held.
 */
export class DataFormatError extends Error {}

const NOT_A_TABLE =
  'This data is not a table. It needs a list of records whose fields each hold a single value.'

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(stripBom(text))
  } catch {
    throw new DataFormatError('This file is not valid JSON.')
  }
}

/** One JSON value per line. Blank lines are skipped. */
export function parseJsonl(text: string): unknown[] {
  const values: unknown[] = []
  const lines = stripBom(text).split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue
    try {
      values.push(JSON.parse(line))
    } catch {
      throw new DataFormatError(
        `This file is not valid JSON Lines: line ${index + 1} is not a JSON value.`,
      )
    }
  }

  return values
}

/** One compact JSON value per line, each line ended. */
export function toJsonl(values: readonly unknown[]): string {
  return values.map((value) => `${JSON.stringify(value)}\n`).join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Named wrappers deeper than this are not a table, and a cycle ends here. */
const MAX_WRAPPERS = 32

/**
 * The records a value holds: the value itself when it is a list, or the list
 * reached by stepping through objects that each hold exactly one property —
 * `{ "items": [...] }`, or XML's `<people><person>…`. An object with more than
 * one property on the way is not a collection: which list would it mean?
 */
function collection(value: unknown): unknown[] {
  let current = value
  for (let depth = 0; depth < MAX_WRAPPERS && isRecord(current); depth++) {
    const fields = Object.values(current)
    if (fields.length !== 1) break
    current = fields[0]
  }
  if (Array.isArray(current)) return current
  throw new DataFormatError(NOT_A_TABLE)
}

/**
 * A list of flat records as a table.
 *
 * Columns appear in the order they are first seen, and a record missing one
 * leaves that cell NULL. Numbers and booleans become their text; null stays
 * null. A nested object or list anywhere refuses the whole table.
 */
export function recordsToTable(name: string, value: unknown): TabularTable {
  const records = collection(value)
  if (records.length === 0) {
    throw new DataFormatError(
      'This data holds no records to make a table from.',
    )
  }

  const columns: string[] = []
  const seen = new Set<string>()
  for (const record of records) {
    if (!isRecord(record)) throw new DataFormatError(NOT_A_TABLE)
    for (const [key, field] of Object.entries(record)) {
      if (typeof field === 'object' && field !== null) {
        throw new DataFormatError(NOT_A_TABLE)
      }
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }

  const rows = records.map((record) =>
    columns.map((column) => {
      const field = Object.prototype.hasOwnProperty.call(record, column)
        ? (record as Record<string, unknown>)[column]
        : null
      return field === null || field === undefined ? null : String(field)
    }),
  )

  return { name, columns, rows }
}

/** A table as records, keyed by headers every writer can use. */
export function tableToRecords(
  table: TabularTable,
): Record<string, string | null>[] {
  const width = table.rows.reduce(
    (widest, row) => Math.max(widest, row.length),
    table.columns.length,
  )
  const columns = normalizeColumns(table.columns, width)
  return table.rows.map((row) =>
    Object.fromEntries(columns.map((column, i) => [column, row[i] ?? null])),
  )
}
