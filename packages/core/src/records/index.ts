import { normalizeColumns, type TabularTable } from '../tabular/columns.js'

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
    throw new DataFormatError('This is not valid JSON.')
  }
}

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

export function toJsonl(values: readonly unknown[]): string {
  return values.map((value) => `${JSON.stringify(value)}\n`).join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Also stops a cycle built from YAML aliases.
const MAX_WRAPPERS = 32

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
