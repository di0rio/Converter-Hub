import {
  POSTGRES_SYNTAX,
  readBalanced,
  splitTopLevel,
  stripLeadingComments,
} from '../shared/syntax.js'
import type { DataBlock } from '../shared/format-parser.js'
import {
  COPY_FROM_STDIN,
  columnListAfter,
  isCopyStatement,
  unquote,
} from './lexer.js'

const CONSTRAINT_KEYWORDS = [
  'CONSTRAINT',
  'PRIMARY',
  'UNIQUE',
  'FOREIGN',
  'CHECK',
  'EXCLUDE',
  'LIKE',
]

const COLUMN_FAMILY = /^FAMILY\s*(?:"(?:[^"]|"")*"\s*)?\(/i

export function readColumns(createStatement: string): string[] {
  const openIndex = createStatement.indexOf('(')
  if (openIndex === -1) return []

  const columns: string[] = []
  const body = readBalanced(createStatement, openIndex, POSTGRES_SYNTAX)

  for (const rawPart of splitTopLevel(body, POSTGRES_SYNTAX)) {
    const part = rawPart.trim()
    if (part.length === 0) continue

    if (part.startsWith('"')) {
      const end = part.indexOf('"', 1)
      if (end > 1) columns.push(unquote(part.slice(0, end + 1)))
      continue
    }

    if (COLUMN_FAMILY.test(part)) continue

    const firstWord = part.split(/\s+/)[0]?.toUpperCase() ?? ''
    if (CONSTRAINT_KEYWORDS.includes(firstWord)) continue

    const bare = part.match(/^([A-Za-z_][A-Za-z0-9_$]*)\s+\S/)
    if (bare) columns.push(bare[1])
  }

  return columns
}

const COPY_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  '\\': '\\',
}

function decodeCopyField(field: string): string | null {
  if (field === '\\N') return null
  if (!field.includes('\\')) return field

  let out = ''
  for (let i = 0; i < field.length; i++) {
    const ch = field[i]
    if (ch !== '\\') {
      out += ch
      continue
    }

    const next = field[++i]
    if (next === undefined) break
    out += COPY_ESCAPES[next] ?? next
  }

  return out
}

function copyDataLines(statement: string): string[] {
  const stripped = stripLeadingComments(statement)
  const header = COPY_FROM_STDIN.exec(stripped)
  if (!header) return []

  const body = stripped.slice(header[0].length)
  const lines: string[] = []

  for (const raw of body.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '\\.') break
    if (line.length === 0) continue
    lines.push(line)
  }

  return lines
}

function decodeLiteral(raw: string): string | null {
  let value = raw.trim()
  if (value.length === 0) return null
  if (value.toUpperCase() === 'NULL') return null

  const cast = value.match(/^([\s\S]*?)::[A-Za-z_][\w\s."[\]]*$/)
  if (cast && /['"]\s*$/.test(cast[1])) value = cast[1].trim()

  const escaped = /^[Ee]'/.test(value)
  if (escaped) value = value.slice(1)

  const quote = value[0]
  if (quote !== "'") return value

  let out = ''
  for (let i = 1; i < value.length - 1; i++) {
    const ch = value[i]

    if (escaped && ch === '\\') {
      const next = value[++i]
      if (next === undefined) break
      out += COPY_ESCAPES[next] ?? next
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

function readTuples(statement: string): string[][] {
  const valuesIndex = statement.search(/\bVALUES\b/i)
  if (valuesIndex === -1) return []

  const tuples: string[][] = []
  let cursor = statement.indexOf('(', valuesIndex)

  while (cursor !== -1) {
    const body = readBalanced(statement, cursor, POSTGRES_SYNTAX)
    if (body.length === 0 && statement[cursor + 1] !== ')') break

    tuples.push(splitTopLevel(body, POSTGRES_SYNTAX))

    cursor = statement.indexOf('(', cursor + body.length + 2)
  }

  return tuples
}

function readInsertColumns(statement: string): string[] | null {
  const valuesIndex = statement.search(/\bVALUES\b/i)
  const openIndex = statement.indexOf('(')
  if (openIndex === -1 || (valuesIndex !== -1 && openIndex > valuesIndex))
    return null

  return columnListAfter(statement, openIndex)
}

export function readDataBlock(statement: string): DataBlock {
  if (isCopyStatement(statement)) {
    const header =
      COPY_FROM_STDIN.exec(stripLeadingComments(statement))?.[0] ?? ''
    return {
      columns: columnListAfter(header, 0),
      rows: copyDataLines(statement).map((line) =>
        line.split('\t').map(decodeCopyField),
      ),
    }
  }

  return {
    columns: readInsertColumns(statement),
    rows: readTuples(statement).map((tuple) => tuple.map(decodeLiteral)),
  }
}

export function countDataRows(statement: string): number {
  return isCopyStatement(statement)
    ? copyDataLines(statement).length
    : readTuples(statement).length
}
