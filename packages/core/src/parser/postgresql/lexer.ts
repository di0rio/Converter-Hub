import {
  POSTGRES_SYNTAX,
  readBalanced,
  splitTopLevel,
  stripLeadingComments,
} from '../shared/syntax.js'

/**
 * A COPY statement whose rows follow it as raw text rather than as SQL.
 * `pg_dump` writes data this way unless it was run with `--inserts`.
 *
 * Applied to a statement with its leading comments stripped, since pg_dump
 * puts a comment block in front of every data section.
 */
export const COPY_FROM_STDIN = /^COPY\b[\s\S]*?\bFROM\s+stdin\s*;/i

export function isCopyStatement(statement: string): boolean {
  return COPY_FROM_STDIN.test(stripLeadingComments(statement))
}

/** The line psql uses to end a COPY data block. */
const COPY_TERMINATOR = '\\.'

function isIdentifierChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch)
}

/** True when nothing but whitespace has been written since the last newline. */
function atLineStart(buffer: string): boolean {
  return /(^|\n)[ \t\r]*$/.test(buffer)
}

/** The `$tag$` opening a dollar-quoted string at `index`, or null. */
function dollarTagAt(sql: string, index: number): string | null {
  const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(index))
  return match ? match[0] : null
}

/**
 * Read a COPY data block: every line after the statement up to and including
 * the `\.` terminator. Returns the raw text and where the scan should resume.
 */
function readCopyData(sql: string, from: number): { block: string; next: number } {
  // The COPY statement ends at its semicolon; data starts on the next line.
  const lineEnd = sql.indexOf('\n', from)
  if (lineEnd === -1) return { block: '', next: sql.length }

  let cursor = lineEnd + 1
  const start = cursor

  while (cursor < sql.length) {
    const end = sql.indexOf('\n', cursor)
    const stop = end === -1 ? sql.length : end
    const line = sql.slice(cursor, stop).replace(/\r$/, '')

    if (line === COPY_TERMINATOR) {
      // Stop before the terminator line: the caller re-adds it, and an extra
      // blank line here would restore as a row with one empty field.
      return {
        block: sql.slice(start, cursor).replace(/\r?\n$/, ''),
        next: end === -1 ? sql.length : end + 1,
      }
    }

    if (end === -1) break
    cursor = end + 1
  }

  // Truncated dump: take what is there rather than losing the rows.
  return { block: sql.slice(start), next: sql.length }
}

/**
 * Split PostgreSQL dump text into statements.
 *
 * Beyond the usual quoting this has to understand three things psql emits that
 * are not SQL statements at all: backslash meta-commands such as `\connect`,
 * dollar-quoted bodies, and COPY blocks whose rows are raw text lines that may
 * contain semicolons.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let i = 0

  function flush(): void {
    const trimmed = current.trim()
    if (trimmed.length > 0) statements.push(trimmed)
    current = ''
  }

  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]

    // psql meta-command: a backslash opening a line owns the rest of that line.
    if (ch === '\\' && atLineStart(current)) {
      flush()
      const end = sql.indexOf('\n', i)
      const line = (end === -1 ? sql.slice(i) : sql.slice(i, end)).trim()
      if (line.length > 0) statements.push(line)
      i = end === -1 ? sql.length : end + 1
      continue
    }

    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i)
      current += end === -1 ? sql.slice(i) : sql.slice(i, end + 1)
      i = end === -1 ? sql.length : end + 1
      continue
    }

    // Block comments nest in PostgreSQL, unlike in MySQL.
    if (ch === '/' && next === '*') {
      let depth = 0
      const start = i
      while (i < sql.length) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++
          i += 2
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--
          i += 2
          if (depth === 0) break
        } else {
          i++
        }
      }
      current += sql.slice(start, i)
      continue
    }

    const tag = ch === '$' ? dollarTagAt(sql, i) : null
    if (tag) {
      const close = sql.indexOf(tag, i + tag.length)
      const end = close === -1 ? sql.length : close + tag.length
      current += sql.slice(i, end)
      i = end
      continue
    }

    // E'...' turns on backslash escapes for one literal.
    if (
      (ch === 'E' || ch === 'e') &&
      next === "'" &&
      !isIdentifierChar(sql[i - 1])
    ) {
      current += ch
      i++
      current += sql[i]
      i++
      while (i < sql.length) {
        const c = sql[i]
        current += c
        if (c === '\\' && i + 1 < sql.length) {
          current += sql[++i]
          i++
          continue
        }
        i++
        if (c === "'") {
          if (sql[i] === "'") {
            current += sql[i]
            i++
            continue
          }
          break
        }
      }
      continue
    }

    // Standard-conforming string: only a doubled quote escapes.
    if (ch === "'" || ch === '"') {
      current += ch
      i++
      while (i < sql.length) {
        const c = sql[i]
        current += c
        i++
        if (c === ch) {
          if (sql[i] === ch) {
            current += sql[i]
            i++
            continue
          }
          break
        }
      }
      continue
    }

    if (ch === ';') {
      current += ';'
      const statement = current.trim()
      current = ''
      i++

      if (statement.length === 0) continue

      if (isCopyStatement(statement)) {
        const { block, next: resume } = readCopyData(sql, i)
        const rows = block.length > 0 ? block + '\n' : ''
        statements.push(statement + '\n' + rows + COPY_TERMINATOR)
        i = resume
        continue
      }

      statements.push(statement)
      continue
    }

    current += ch
    i++
  }

  flush()
  return statements
}

// ------------------------------------------------------------ identifiers

const IDENTIFIER = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`

/** `schema.table`, `"My Schema"."My Table"` or a bare name. */
export const QUALIFIED_NAME = String.raw`(${IDENTIFIER})(?:\s*\.\s*(${IDENTIFIER}))?`

export interface QualifiedName {
  /** `null` when the statement did not qualify the name with a schema. */
  schema: string | null
  name: string
}

export function unquote(raw: string): string {
  const value = raw.trim()
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).split('""').join('"')
  }
  return value
}

/** Read the qualified name that follows `prefix` in a statement. */
export function qualifiedNameAfter(
  sql: string,
  prefix: string,
): QualifiedName | null {
  const match = new RegExp(prefix + String.raw`\s*` + QUALIFIED_NAME, 'i').exec(sql)
  if (!match) return null

  const first = unquote(match[1])
  const second = match[2] ? unquote(match[2]) : null

  return second !== null ? { schema: first, name: second } : { schema: null, name: first }
}

/** The parenthesised column list of a COPY or INSERT header, if it has one. */
export function columnListAfter(sql: string, headerEnd: number): string[] | null {
  const open = sql.indexOf('(', headerEnd)
  if (open === -1) return null

  const body = readBalanced(sql, open, POSTGRES_SYNTAX)
  if (body.trim().length === 0) return null

  return splitTopLevel(body, POSTGRES_SYNTAX).map(unquote)
}
