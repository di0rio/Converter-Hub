import type { Table } from '../types/index.js'

export interface TabularTable {
  name: string
  columns: string[]
  rows: (string | null)[][]
}

const CONSTRAINT_KEYWORDS = [
  'PRIMARY',
  'UNIQUE',
  'KEY',
  'INDEX',
  'CONSTRAINT',
  'FOREIGN',
  'FULLTEXT',
  'SPATIAL',
  'CHECK',
]

/**
 * Return the body of a parenthesised clause starting at `openIndex`,
 * respecting nesting, string literals and backtick identifiers.
 */
function readBalanced(sql: string, openIndex: number): string {
  let depth = 0
  let quote: string | null = null

  for (let i = openIndex; i < sql.length; i++) {
    const ch = sql[i]

    if (quote) {
      if (ch === '\\') {
        i++
      } else if (ch === quote) {
        if (quote !== '`' && sql[i + 1] === quote) i++
        else quote = null
      }
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }

    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return sql.slice(openIndex + 1, i)
    }
  }

  return ''
}

/** Split on commas that sit at nesting depth zero and outside any quoting. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let quote: string | null = null

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]

    if (quote) {
      current += ch
      if (ch === '\\') {
        if (i + 1 < body.length) current += body[++i]
      } else if (ch === quote) {
        if (quote !== '`' && body[i + 1] === quote) current += body[++i]
        else quote = null
      }
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      current += ch
      continue
    }

    if (ch === '(') depth++
    else if (ch === ')') depth--

    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }

    current += ch
  }

  if (current.trim().length > 0) parts.push(current)
  return parts
}

/**
 * Column names from a CREATE TABLE statement, in declaration order.
 * Constraint and index clauses are skipped.
 */
export function extractColumns(createStatement: string): string[] {
  const openIndex = createStatement.indexOf('(')
  if (openIndex === -1) return []

  const columns: string[] = []

  for (const rawPart of splitTopLevel(readBalanced(createStatement, openIndex))) {
    const part = rawPart.trim()
    if (part.length === 0) continue

    if (part.startsWith('`')) {
      const end = part.indexOf('`', 1)
      if (end > 1) columns.push(part.slice(1, end))
      continue
    }

    const firstWord = part.split(/\s+/)[0]?.toUpperCase() ?? ''
    if (CONSTRAINT_KEYWORDS.includes(firstWord)) continue

    const bare = part.match(/^([A-Za-z0-9_$]+)\s+\S/)
    if (bare) columns.push(bare[1])
  }

  return columns
}

/** Decode one SQL literal into the string a spreadsheet cell should hold. */
function decodeLiteral(raw: string): string | null {
  const value = raw.trim()
  if (value.length === 0) return null
  if (value.toUpperCase() === 'NULL') return null

  const quote = value[0]
  if (quote !== "'" && quote !== '"') return value

  let out = ''
  for (let i = 1; i < value.length - 1; i++) {
    const ch = value[i]

    if (ch === '\\') {
      const next = value[++i]
      if (next === 'n') out += '\n'
      else if (next === 't') out += '\t'
      else if (next === 'r') out += '\r'
      else if (next === '0') out += '\0'
      else if (next === undefined) break
      else out += next
      continue
    }

    if (ch === quote && value[i + 1] === quote) {
      out += quote
      i++
      continue
    }

    out += ch
  }

  return out
}

/** Value tuples from a single INSERT statement. */
function extractTuples(insertStatement: string): string[][] {
  const valuesIndex = insertStatement.search(/\bVALUES\b/i)
  if (valuesIndex === -1) return []

  const tuples: string[][] = []
  let cursor = insertStatement.indexOf('(', valuesIndex)

  while (cursor !== -1) {
    const body = readBalanced(insertStatement, cursor)
    if (body.length === 0 && insertStatement[cursor + 1] !== ')') break

    tuples.push(splitTopLevel(body))

    cursor = insertStatement.indexOf('(', cursor + body.length + 2)
  }

  return tuples
}

/** Explicit column list from `INSERT INTO t (a, b) VALUES ...`, if present. */
function extractInsertColumns(insertStatement: string): string[] | null {
  const valuesIndex = insertStatement.search(/\bVALUES\b/i)
  const openIndex = insertStatement.indexOf('(')
  if (openIndex === -1 || (valuesIndex !== -1 && openIndex > valuesIndex)) return null

  return splitTopLevel(readBalanced(insertStatement, openIndex)).map((part) =>
    part.trim().replace(/^`|`$/g, ''),
  )
}

/**
 * Number of data rows a table holds.
 *
 * Counts the value tuples inside every INSERT statement, so one multi-row
 * INSERT counts as its rows rather than as one statement. CREATE TABLE,
 * comments and blank lines are not data and are never counted.
 *
 * This skips literal decoding, so it stays cheap enough to call for every
 * table in a dump.
 */
export function countRows(table: Table): number {
  let total = 0
  for (const statement of table.insertStatements) {
    total += extractTuples(statement).length
  }
  return total
}

/**
 * Flatten a parsed table into the columns and rows a CSV or spreadsheet needs.
 *
 * This reads only the SQL text already captured by the parser. Nothing is
 * executed, and no value is interpreted beyond unescaping its literal.
 */
export function toTabular(table: Table): TabularTable {
  const columns = extractColumns(table.createStatement)
  const rows: (string | null)[][] = []

  for (const statement of table.insertStatements) {
    const insertColumns = extractInsertColumns(statement)

    for (const tuple of extractTuples(statement)) {
      const values = tuple.map(decodeLiteral)

      if (insertColumns && columns.length > 0) {
        const row = columns.map((column) => {
          const index = insertColumns.indexOf(column)
          return index === -1 ? null : (values[index] ?? null)
        })
        rows.push(row)
        continue
      }

      rows.push(values)
    }
  }

  // A dump with INSERTs but no CREATE TABLE still deserves usable output.
  if (columns.length === 0 && rows.length > 0) {
    const width = Math.max(...rows.map((row) => row.length))
    return {
      name: table.name,
      columns: Array.from({ length: width }, (_, i) => `column_${i + 1}`),
      rows,
    }
  }

  return { name: table.name, columns, rows }
}
