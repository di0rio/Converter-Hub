import type { SqlSyntax } from './syntax.js'
import {
  identifierCloserFor,
  stripLeadingComments,
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
   * A statement head that opens a `BEGIN ... END` body, matched against the
   * start of a statement.
   *
   * Inside such a body every `;` belongs to the body, not to the script: only
   * a terminator directly after `END` closes the statement. Dialects that keep
   * bodies apart some other way — Firebird's `SET TERM`, Oracle's `/` — do not
   * need this and leave it null.
   *
   * Bodies are assumed not to nest, which holds for the triggers this covers.
   */
  compoundBody: RegExp | null
  /**
   * Keywords that begin a new statement even with no terminator in front of
   * them, matched against the start of a line at paren depth zero.
   *
   * T-SQL needs this: SSMS scripts data as bare `INSERT ... VALUES (...)`
   * lines stacked many-per-batch with no semicolons at all, and without this
   * they merge into one blob whose values decode as nonsense rows.
   *
   * Only keywords that can never continue the previous statement belong here.
   * `SELECT`, `SET` and `UPDATE` must not: `INSERT INTO t` / `SELECT ...` and
   * `UPDATE t` / `SET c = 1` both legitimately span lines that way.
   */
  statementStarters: RegExp | null
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
  compoundBody: null,
  statementStarters: null,
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
  statementStarters:
    /^(INSERT|CREATE|ALTER|DROP|TRUNCATE|USE|EXEC|EXECUTE|PRINT|GRANT|DENY|REVOKE)\b/i,
  stringPrefixes: ['N'],
}

export const SQLITE_DIALECT: SqlDialect = {
  ...BASE,
  syntax: SQLITE_SYNTAX,
  // A trigger body holds statements of its own. SQLite has no batch separator
  // and no terminator swap, so END is the only thing that closes one.
  compoundBody: /^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i,
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

/** Escape a terminator so it can sit inside a regular expression. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * `SET TERM <new> <current>` — Firebird's terminator swap.
 *
 * The line always ends with the terminator in force at the time it is read,
 * and that is what marks where the new one stops. Assuming it ends with a
 * semicolon breaks the swap back: `SET TERM ; ^` ends with `^`, so the script
 * would never return to `;` and everything after it would merge into one
 * statement.
 */
function readTermSwap(line: string, current: string): string | null {
  const match = new RegExp(
    '^SET\\s+TERM\\s+(.+?)\\s*' + escapeForRegExp(current) + '\\s*$',
    'i',
  ).exec(line)

  return match ? (match[1] as string) : null
}

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
  /** Parenthesis nesting, outside quotes and comments. */
  let depth = 0

  /** Whether what has been read so far opens a BEGIN ... END body. */
  function opensCompoundBody(text: string): boolean {
    return dialect.compoundBody?.test(stripLeadingComments(text)) ?? false
  }

  /** Whether the text ends at the END that closes such a body. */
  function endsCompoundBody(text: string): boolean {
    return new RegExp('\\bEND\\s*' + escapeForRegExp(terminator) + '\\s*$', 'i').test(text)
  }

  function flush(): void {
    const trimmed = current.trim()
    if (trimmed.length > 0) statements.push(trimmed)
    current = ''
    // An unbalanced statement must not leave later ones stuck inside it.
    depth = 0
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
        const swap = readTermSwap(trimmed, terminator)
        if (swap !== null) {
          flush()
          terminator = swap
          i = end + 1
          continue
        }
      }

      // A keyword that cannot continue the statement in hand starts a new one,
      // even though nothing terminated the last. Only outside parentheses: a
      // column list may well have a line beginning with one of these words.
      if (
        depth === 0 &&
        current.trim().length > 0 &&
        !opensCompoundBody(current) &&
        dialect.statementStarters?.test(trimmed)
      ) {
        flush()
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

      // Inside a compound body the terminator belongs to the body. Only one
      // sitting directly after END closes the statement itself.
      if (opensCompoundBody(current) && !endsCompoundBody(current)) continue

      flush()
      continue
    }

    if (ch === '(') depth++
    else if (ch === ')' && depth > 0) depth--

    current += ch
    i++
  }

  flush()
  return statements
}
