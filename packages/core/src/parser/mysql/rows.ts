import {
  MYSQL_SYNTAX,
  readBalanced,
  splitTopLevel,
  unquoteIdentifier,
} from '../shared/syntax.js'
import type { DataBlock } from '../shared/format-parser.js'

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

const VENDOR_INDEX_CLAUSE = /^(SHARD|SORT|CLUSTERED)\s+KEY\b/i

export function readColumns(createStatement: string): string[] {
  const openIndex = createStatement.indexOf('(')
  if (openIndex === -1) return []

  const columns: string[] = []
  const body = readBalanced(createStatement, openIndex, MYSQL_SYNTAX)

  for (const rawPart of splitTopLevel(body, MYSQL_SYNTAX)) {
    const part = rawPart.trim()
    if (part.length === 0) continue

    if (part.startsWith('`')) {
      const end = part.indexOf('`', 1)
      if (end > 1) columns.push(part.slice(1, end))
      continue
    }

    if (VENDOR_INDEX_CLAUSE.test(part)) continue

    const firstWord = part.split(/\s+/)[0]?.toUpperCase() ?? ''
    if (CONSTRAINT_KEYWORDS.includes(firstWord)) continue

    const bare = part.match(/^([A-Za-z0-9_$]+)\s+\S/)
    if (bare) columns.push(bare[1])
  }

  return columns
}

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

function readTuples(insertStatement: string): string[][] {
  const valuesIndex = insertStatement.search(/\bVALUES\b/i)
  if (valuesIndex === -1) return []

  const tuples: string[][] = []
  let cursor = insertStatement.indexOf('(', valuesIndex)

  while (cursor !== -1) {
    const body = readBalanced(insertStatement, cursor, MYSQL_SYNTAX)
    if (body.length === 0 && insertStatement[cursor + 1] !== ')') break

    tuples.push(splitTopLevel(body, MYSQL_SYNTAX))

    cursor = insertStatement.indexOf('(', cursor + body.length + 2)
  }

  return tuples
}

function readInsertColumns(insertStatement: string): string[] | null {
  const valuesIndex = insertStatement.search(/\bVALUES\b/i)
  const openIndex = insertStatement.indexOf('(')
  if (openIndex === -1 || (valuesIndex !== -1 && openIndex > valuesIndex))
    return null

  const body = readBalanced(insertStatement, openIndex, MYSQL_SYNTAX)
  return splitTopLevel(body, MYSQL_SYNTAX).map((part) =>
    unquoteIdentifier(part, MYSQL_SYNTAX),
  )
}

export function readDataBlock(statement: string): DataBlock {
  return {
    columns: readInsertColumns(statement),
    rows: readTuples(statement).map((tuple) => tuple.map(decodeLiteral)),
  }
}

export function countDataRows(statement: string): number {
  return readTuples(statement).length
}
