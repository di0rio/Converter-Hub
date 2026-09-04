import type { SqlDialect } from './dialect.js'
import type { DataBlock } from './format-parser.js'
import {
  readBalanced,
  splitTopLevel,
  stripLeadingComments,
  unquoteIdentifier,
} from './syntax.js'

/**
 * Reading columns and rows out of ordinary DDL and INSERT statements, driven
 * by a dialect rather than written once per format.
 *
 * A format only needs its own reader for something genuinely different —
 * PostgreSQL's COPY blocks, say. Plain `CREATE TABLE` and `INSERT` look close
 * enough across engines that the differences are all lexical, and lexical
 * differences live in the dialect.
 */

/**
 * Clauses inside CREATE TABLE that declare something other than a column.
 *
 * The union across supported dialects. A keyword that is a constraint in one
 * engine is not a column name in another, so over-including here is safe in a
 * way that under-including is not.
 */
const CONSTRAINT_KEYWORDS = new Set([
  'PRIMARY',
  'UNIQUE',
  'KEY',
  'INDEX',
  'CONSTRAINT',
  'FOREIGN',
  'FULLTEXT',
  'SPATIAL',
  'CHECK',
  'EXCLUDE',
  'LIKE',
  'PERIOD',
])

/**
 * Column names from a CREATE TABLE statement, in declaration order.
 *
 * Only the first token of each clause can be a name: dialects write types as
 * several words (`character varying(255)`, `timestamp without time zone`), so
 * everything after the first token is type or modifier text.
 */
export function readColumns(
  createStatement: string,
  dialect: SqlDialect,
): string[] {
  const openIndex = createStatement.indexOf('(')
  if (openIndex === -1) return []

  const { syntax } = dialect
  const columns: string[] = []
  const body = readBalanced(createStatement, openIndex, syntax)

  for (const rawPart of splitTopLevel(body, syntax)) {
    const part = rawPart.trim()
    if (part.length === 0) continue

    // A quoted first token is a name whatever it spells — including a word
    // that would otherwise read as a constraint keyword.
    const quoted = readQuotedHead(part, dialect)
    if (quoted !== null) {
      columns.push(quoted)
      continue
    }

    const firstWord = part.split(/\s+/)[0]?.toUpperCase() ?? ''
    if (CONSTRAINT_KEYWORDS.has(firstWord)) continue

    const bare = part.match(/^([A-Za-z_][A-Za-z0-9_$]*)\s+\S/)
    if (bare) columns.push(bare[1] as string)
  }

  return columns
}

/** The unquoted value of a leading quoted identifier, or null if unquoted. */
function readQuotedHead(part: string, dialect: SqlDialect): string | null {
  const first = part[0]
  if (first === undefined) return null

  for (const spec of dialect.syntax.identifierQuotes) {
    const open = typeof spec === 'string' ? spec : spec.open
    const close = typeof spec === 'string' ? spec : spec.close
    if (open !== first) continue

    const end = part.indexOf(close, 1)
    if (end > 0)
      return unquoteIdentifier(part.slice(0, end + 1), dialect.syntax)
  }

  return null
}

// ------------------------------------------------------------- literals

/** Escape sequences that mean something other than the character itself. */
const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
  '\\': '\\',
}

/**
 * Decode one SQL literal into the string a spreadsheet cell should hold.
 *
 * Values that are not string literals — numbers, keywords, hex and function
 * calls — are handed back as written. Nothing is evaluated: a value that looks
 * like a call stays the text of that call rather than becoming its result.
 */
export function decodeLiteral(raw: string, dialect: SqlDialect): string | null {
  let value = raw.trim()
  if (value.length === 0) return null
  if (value.toUpperCase() === 'NULL') return null

  // A trailing cast (`'{}'::jsonb`) is type information, not part of the value.
  const cast = value.match(/^([\s\S]*?)::[A-Za-z_][\w\s."[\]]*$/)
  if (cast && /['"]\s*$/.test(cast[1] as string))
    value = (cast[1] as string).trim()

  // A one-letter prefix marks the literal's kind without moving where it ends.
  let backslashes = dialect.syntax.backslashEscapes
  const prefix = value[0]
  if (
    prefix !== undefined &&
    value[1] === "'" &&
    dialect.stringPrefixes.includes(prefix.toUpperCase())
  ) {
    // X'ff' and B'01' are binary; keep them as written rather than inventing
    // a text rendering of bytes.
    const upper = prefix.toUpperCase()
    if (upper === 'X' || upper === 'B') return value
    if (upper === 'E') backslashes = true
    value = value.slice(1)
  }

  if (value[0] !== "'") return value

  let out = ''
  for (let i = 1; i < value.length - 1; i++) {
    const ch = value[i] as string

    if (backslashes && ch === '\\') {
      const escaped = value[++i]
      if (escaped === undefined) break
      out += ESCAPES[escaped] ?? escaped
      continue
    }

    if (ch === "'" && value[i + 1] === "'") {
      out += "'"
      i++
      continue
    }

    out += ch
  }

  return out
}

// -------------------------------------------------------------- INSERT

/** Value tuples from a single INSERT statement. */
function readTuples(statement: string, dialect: SqlDialect): string[][] {
  const valuesIndex = statement.search(/\bVALUES\b/i)
  if (valuesIndex === -1) return []

  const { syntax } = dialect
  const tuples: string[][] = []
  let cursor = statement.indexOf('(', valuesIndex)

  while (cursor !== -1) {
    const body = readBalanced(statement, cursor, syntax)
    if (body.length === 0 && statement[cursor + 1] !== ')') break

    tuples.push(splitTopLevel(body, syntax))

    cursor = statement.indexOf('(', cursor + body.length + 2)
  }

  return tuples
}

/** Explicit column list from `INSERT INTO t (a, b) VALUES ...`, if present. */
function readInsertColumns(
  statement: string,
  dialect: SqlDialect,
): string[] | null {
  const valuesIndex = statement.search(/\bVALUES\b/i)
  const openIndex = statement.indexOf('(')
  if (openIndex === -1 || (valuesIndex !== -1 && openIndex > valuesIndex))
    return null

  const body = readBalanced(statement, openIndex, dialect.syntax)
  if (body.trim().length === 0) return null

  return splitTopLevel(body, dialect.syntax).map((part) =>
    unquoteIdentifier(part, dialect.syntax),
  )
}

/** Decode one INSERT statement into cell values. */
export function readInsertBlock(
  statement: string,
  dialect: SqlDialect,
): DataBlock {
  const clean = stripLeadingComments(statement)
  return {
    columns: readInsertColumns(clean, dialect),
    rows: readTuples(clean, dialect).map((tuple) =>
      tuple.map((value) => decodeLiteral(value, dialect)),
    ),
  }
}

/**
 * Rows in one INSERT, counted without decoding any value.
 *
 * One multi-row INSERT counts as its rows rather than as one statement.
 */
export function countInsertRows(
  statement: string,
  dialect: SqlDialect,
): number {
  return readTuples(stripLeadingComments(statement), dialect).length
}
