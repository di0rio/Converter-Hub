import type { SqlSyntax } from './syntax.js'
import {
  identifierCloserFor,
  MYSQL_SYNTAX,
  POSTGRES_SYNTAX,
  SQLITE_SYNTAX,
  SQLSERVER_SYNTAX,
  STANDARD_SYNTAX,
} from './syntax.js'

/**
 * The lexical shape of one SQL dialect, as data.
 *
 * Splitting a dump into statements is the part every format needs and the part
 * that is easy to get wrong — a semicolon inside a string, a comment, or a
 * procedure body must not end a statement. Describing the differences as data
 * means a new format supplies a dialect rather than another hand-written
 * splitter, which is what keeps the fiftieth format cheaper than the fifth.
 */
export interface SqlDialect {
  /** Identifier quoting and string escaping. */
  syntax: SqlSyntax
  /** Statement terminator. The starting value; SET TERM can replace it. */
  terminator: string
  /**
   * A line that ends a batch rather than a statement: `GO` in T-SQL, a lone
   * `/` in Oracle. Matched against a whole trimmed line.
   */
  batchSeparator: RegExp | null
  /** `#` opens a line comment. MySQL only. */
  hashComments: boolean
  /** Block comments nest. PostgreSQL only. */
  nestedBlockComments: boolean
  /** Honour `SET TERM x ;`, which swaps the terminator. Firebird only. */
  settableTerminator: boolean
  /** `$tag$ ... $tag$` bodies. PostgreSQL only. */
  dollarQuoting: boolean
  /**
   * Letters that may prefix a string literal: `N'x'` (T-SQL national),
   * `E'x'` (PostgreSQL escape), `X'ff'` / `B'01'` (binary and bit literals).
   * A prefix never changes where the literal ends, only how it decodes.
   */
  stringPrefixes: readonly string[]
}

const BASE: Omit<SqlDialect, 'syntax'> = {
  terminator: ';',
  batchSeparator: null,
  hashComments: false,
  nestedBlockComments: false,
  settableTerminator: false,
  dollarQuoting: false,
  stringPrefixes: [],
}

export const MYSQL_DIALECT: SqlDialect = {
  ...BASE,
  syntax: MYSQL_SYNTAX,
  hashComments: true,
  stringPrefixes: ['X', 'B', '_'],
}

export const POSTGRES_DIALECT: SqlDialect = {
  ...BASE,
  syntax: POSTGRES_SYNTAX,
  nestedBlockComments: true,
  dollarQuoting: true,
  stringPrefixes: ['E', 'U', 'B', 'X'],
}

/** T-SQL: `GO` ends a batch, and it may carry a repeat count. */
export const SQLSERVER_DIALECT: SqlDialect = {
  ...BASE,
  syntax: SQLSERVER_SYNTAX,
  batchSeparator: /^GO(\s+\d+)?$/i,
  stringPrefixes: ['N'],
}

export const SQLITE_DIALECT: SqlDialect = {
  ...BASE,
  syntax: SQLITE_SYNTAX,
  stringPrefixes: ['X'],
}

/** Firebird: `SET TERM ^ ;` swaps the terminator around procedure bodies. */
export const FIREBIRD_DIALECT: SqlDialect = {
  ...BASE,
  syntax: STANDARD_SYNTAX,
  settableTerminator: true,
  stringPrefixes: ['X'],
}

/** Oracle: a lone `/` runs the preceding block, including PL/SQL bodies. */
export const ORACLE_DIALECT: SqlDialect = {
  ...BASE,
  syntax: STANDARD_SYNTAX,
  batchSeparator: /^\/$/,
  stringPrefixes: ['N', 'Q'],
}

export const DB2_DIALECT: SqlDialect = {
  ...BASE,
  syntax: STANDARD_SYNTAX,
  stringPrefixes: ['X', 'N'],
}

// ------------------------------------------------------------ splitting

/** `SET TERM <token> <old terminator>` — Firebird's terminator swap. */
const SET_TERM = /^SET\s+TERM\s+(\S+?)\s*(?:;|\s)$/i

function isIdentifierChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch)
}

/**
 * Split a SQL script into statements.
 *
 * Understands, per dialect: line and block comments, string literals with
 * their prefixes, quoted identifiers in every supported bracketing, dollar
 * quoting, batch separator lines, and a terminator that a statement may
 * itself change. A semicolon inside any of those does not end a statement.
 *
 * Statement text is returned verbatim, including its terminator, because every
 * parser above this stores the source text so a SQL export stays valid for the
 * engine the dump came from.
 */
export function splitScript(sql: string, dialect: SqlDialect): string[] {
  const statements: string[] = []
  const { syntax } = dialect

  let terminator = dialect.terminator
  let current = ''
  let i = 0

  function flush(): void {
    const trimmed = current.trim()
    if (trimmed.length > 0) statements.push(trimmed)
    current = ''
  }

  /** True when nothing but whitespace has been written since the last newline. */
  function atLineStart(): boolean {
    return /(^|\n)[ \t\r]*$/.test(current)
  }

  /** The whole line beginning at `from`, without its line break. */
  function lineAt(from: number): { text: string; end: number } {
    const end = sql.indexOf('\n', from)
    const stop = end === -1 ? sql.length : end
    return { text: sql.slice(from, stop).replace(/\r$/, ''), end: stop }
  }

  while (i < sql.length) {
    const ch = sql[i] as string
    const next = sql[i + 1]

    // A batch separator, or a terminator swap, owns its whole line. Both are
    // only meaningful when nothing else sits in front of them on that line.
    if (atLineStart() && !/\s/.test(ch)) {
      const { text, end } = lineAt(i)
      const trimmed = text.trim()

      if (dialect.batchSeparator?.test(trimmed)) {
        flush()
        i = end + 1
        continue
      }

      if (dialect.settableTerminator) {
        const swap = SET_TERM.exec(trimmed)
        if (swap) {
          flush()
          terminator = swap[1] as string
          i = end + 1
          continue
        }
      }
    }

    if (ch === '-' && next === '-') {
      const { end } = lineAt(i)
      current += sql.slice(i, end)
      i = end
      continue
    }

    if (dialect.hashComments && ch === '#') {
      const { end } = lineAt(i)
      current += sql.slice(i, end)
      i = end
      continue
    }

    if (ch === '/' && next === '*') {
      const start = i
      let depth = 0
      while (i < sql.length) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++
          i += 2
          if (!dialect.nestedBlockComments) {
            // Only the outermost opener counts; find the first close.
            const close = sql.indexOf('*/', i)
            i = close === -1 ? sql.length : close + 2
            depth = 0
            break
          }
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

    if (dialect.dollarQuoting && ch === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i))?.[0]
      if (tag) {
        const close = sql.indexOf(tag, i + tag.length)
        const end = close === -1 ? sql.length : close + tag.length
        current += sql.slice(i, end)
        i = end
        continue
      }
    }

    // A literal may carry a one-letter prefix: N'x', E'x', X'ff'.
    let quoteStart = -1
    let backslashes = syntax.backslashEscapes
    if (ch === "'") {
      quoteStart = i
    } else if (
      next === "'" &&
      dialect.stringPrefixes.includes(ch.toUpperCase()) &&
      !isIdentifierChar(sql[i - 1])
    ) {
      // E'...' opts back into backslash escapes for one literal.
      if (ch.toUpperCase() === 'E') backslashes = true
      current += ch
      i++
      quoteStart = i
    }

    if (quoteStart !== -1) {
      current += sql[i]
      i++
      while (i < sql.length) {
        const c = sql[i] as string
        current += c
        if (c === '\\' && backslashes && i + 1 < sql.length) {
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

    const closer = identifierCloserFor(syntax, ch)
    if (closer !== null) {
      current += ch
      i++
      while (i < sql.length) {
        const c = sql[i] as string
        current += c
        i++
        if (c === closer) {
          if (sql[i] === closer) {
            current += sql[i]
            i++
            continue
          }
          break
        }
      }
      continue
    }

    if (sql.startsWith(terminator, i)) {
      current += terminator
      i += terminator.length
      flush()
      continue
    }

    current += ch
    i++
  }

  flush()
  return statements
}
