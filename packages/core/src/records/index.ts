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

const NUMBERED = /^(.*?)\d+$/

// ERP exports write <PROD_1>, <PROD_7>… instead of repeating one element. Every
// key must share the prefix and hold a record, so line1/line2 is not a list.
function numbered(value: Record<string, unknown>): unknown[] | null {
  const keys = Object.keys(value)
  const prefix = keys[0] === undefined ? undefined : NUMBERED.exec(keys[0])?.[1]
  if (prefix === undefined) return null
  for (const key of keys) {
    if (NUMBERED.exec(key)?.[1] !== prefix || !isRecord(value[key])) return null
  }
  return Object.values(value)
}

interface Collection {
  name: string
  records: unknown[]
}

// One property is a wrapper and keeps the outer name; several are one list each.
function collections(name: string, value: unknown, depth = 0): Collection[] {
  if (Array.isArray(value)) return [{ name, records: value }]
  if (value === '') return []
  if (!isRecord(value) || depth >= MAX_WRAPPERS) {
    throw new DataFormatError(NOT_A_TABLE)
  }
  const list = numbered(value)
  if (list) return [{ name, records: list }]

  const entries = Object.entries(value)
  const [only] = entries
  if (entries.length === 1 && only) {
    return collections(name, only[1], depth + 1)
  }
  return entries.flatMap(([key, field]) => collections(key, field, depth + 1))
}

function flatten(
  record: Record<string, unknown>,
  into: Map<string, unknown>,
  prefix = '',
  depth = 0,
): void {
  for (const [key, field] of Object.entries(record)) {
    const column = prefix ? `${prefix}.${key}` : key
    if (Array.isArray(field) || depth >= MAX_WRAPPERS) {
      throw new DataFormatError(NOT_A_TABLE)
    }
    if (isRecord(field)) flatten(field, into, column, depth + 1)
    else into.set(column, field)
  }
}

function toTable({ name, records }: Collection): TabularTable {
  const columns: string[] = []
  const seen = new Set<string>()
  const flat = records.map((record) => {
    if (!isRecord(record)) throw new DataFormatError(NOT_A_TABLE)
    const fields = new Map<string, unknown>()
    flatten(record, fields)
    for (const column of fields.keys()) {
      if (!seen.has(column)) {
        seen.add(column)
        columns.push(column)
      }
    }
    return fields
  })

  const rows = flat.map((fields) =>
    columns.map((column) => {
      const field = fields.get(column)
      return field === null || field === undefined ? null : String(field)
    }),
  )
  return { name, columns, rows }
}

export function recordsToTables(name: string, value: unknown): TabularTable[] {
  const tables = collections(name, value)
    .filter((collection) => collection.records.length > 0)
    .map(toTable)
  if (tables.length === 0) {
    throw new DataFormatError(
      'This data holds no records to make a table from.',
    )
  }
  return tables
}

export function recordsToTable(name: string, value: unknown): TabularTable {
  const [table, ...rest] = recordsToTables(name, value)
  if (!table || rest.length > 0) throw new DataFormatError(NOT_A_TABLE)
  return table
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
