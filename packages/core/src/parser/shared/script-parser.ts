import type { SqlDialect } from './dialect.js'
import type { DataBlock } from './format-parser.js'
import {
  readBalanced,
  splitTopLevel,
  stripLeadingComments,
  unquoteIdentifier,
} from './syntax.js'

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

export function decodeLiteral(raw: string, dialect: SqlDialect): string | null {
  let value = raw.trim()
  if (value.length === 0) return null
  if (value.toUpperCase() === 'NULL') return null

  const cast = value.match(/^([\s\S]*?)::[A-Za-z_][\w\s."[\]]*$/)
  if (cast && /['"]\s*$/.test(cast[1] as string))
    value = (cast[1] as string).trim()

  let backslashes = dialect.syntax.backslashEscapes
  const prefix = value[0]
  if (
    prefix !== undefined &&
    value[1] === "'" &&
    dialect.stringPrefixes.includes(prefix.toUpperCase())
  ) {
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

export function countInsertRows(
  statement: string,
  dialect: SqlDialect,
): number {
  return readTuples(stripLeadingComments(statement), dialect).length
}
