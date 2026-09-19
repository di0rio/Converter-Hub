import type { SqlSyntax } from './syntax.js'
import {
  identifierCloserFor,
  stripLeadingComments,
  MYSQL_SYNTAX,
  POSTGRES_SYNTAX,
  SQLITE_SYNTAX,
  SQLSERVER_SYNTAX,
  STANDARD_SYNTAX,
  CQL_SYNTAX,
} from './syntax.js'

export interface SqlDialect {
  syntax: SqlSyntax
  terminator: string
  batchSeparator: RegExp | null
  hashComments: boolean
  lineCommentKeyword: RegExp | null
  nestedBlockComments: boolean
  settableTerminator: boolean
  dollarQuoting: boolean
  compoundBody: RegExp | null
  deferToBatchSeparator: RegExp | null
  statementStarters: RegExp | null
  stringPrefixes: readonly string[]
}

const BASE: Omit<SqlDialect, 'syntax'> = {
  terminator: ';',
  batchSeparator: null,
  hashComments: false,
  lineCommentKeyword: null,
  nestedBlockComments: false,
  settableTerminator: false,
  dollarQuoting: false,
  compoundBody: null,
  deferToBatchSeparator: null,
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
  compoundBody: /^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i,
  stringPrefixes: ['X'],
}

export const FIREBIRD_DIALECT: SqlDialect = {
  ...BASE,
  syntax: STANDARD_SYNTAX,
  settableTerminator: true,
  stringPrefixes: ['X'],
}

export const ORACLE_DIALECT: SqlDialect = {
  ...BASE,
  syntax: STANDARD_SYNTAX,
  batchSeparator: /^\/$/,
  lineCommentKeyword: /^(REM|PROMPT)(\s|$)/i,
  deferToBatchSeparator:
    /^(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:TRIGGER|PROCEDURE|FUNCTION|PACKAGE|TYPE)\b|DECLARE\b|BEGIN\b)/i,
  stringPrefixes: ['N', 'Q'],
}

export const CQL_DIALECT: SqlDialect = {
  ...BASE,
  syntax: CQL_SYNTAX,
  stringPrefixes: [],
}

export const ANSI_DIALECT: SqlDialect = {
  ...BASE,
  syntax: STANDARD_SYNTAX,
}

export const DB2_DIALECT: SqlDialect = {
  ...BASE,
  syntax: STANDARD_SYNTAX,
  stringPrefixes: ['X', 'N'],
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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

export function splitScript(sql: string, dialect: SqlDialect): string[] {
  const statements: string[] = []
  const { syntax } = dialect

  let terminator = dialect.terminator
  let current = ''
  let i = 0
  let depth = 0

  function statementHead(text: string): string {
    let rest = stripLeadingComments(text)

    while (dialect.lineCommentKeyword?.test(rest)) {
      const newline = rest.indexOf('\n')
      if (newline === -1) return ''
      rest = stripLeadingComments(rest.slice(newline + 1))
    }

    return rest
  }

  function opensCompoundBody(text: string): boolean {
    return dialect.compoundBody?.test(statementHead(text)) ?? false
  }

  function opensDeferredBlock(text: string): boolean {
    return dialect.deferToBatchSeparator?.test(statementHead(text)) ?? false
  }

  function endsCompoundBody(text: string): boolean {
    return new RegExp(
      '\\bEND\\s*' + escapeForRegExp(terminator) + '\\s*$',
      'i',
    ).test(text)
  }

  function flush(): void {
    const trimmed = current.trim()
    if (trimmed.length > 0) statements.push(trimmed)
    current = ''
    depth = 0
  }

  function atLineStart(): boolean {
    return /(^|\n)[ \t\r]*$/.test(current)
  }

  function lineAt(from: number): { text: string; end: number } {
    const end = sql.indexOf('\n', from)
    const stop = end === -1 ? sql.length : end
    return { text: sql.slice(from, stop).replace(/\r$/, ''), end: stop }
  }

  while (i < sql.length) {
    const ch = sql[i] as string
    const next = sql[i + 1]

    if (atLineStart() && !/\s/.test(ch)) {
      const { text, end } = lineAt(i)
      const trimmed = text.trim()

      if (dialect.batchSeparator?.test(trimmed)) {
        flush()
        i = end + 1
        continue
      }

      if (dialect.lineCommentKeyword?.test(trimmed)) {
        current += sql.slice(i, end)
        i = end
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

    let quoteStart = -1
    let backslashes = syntax.backslashEscapes
    if (ch === "'") {
      quoteStart = i
    } else if (
      next === "'" &&
      dialect.stringPrefixes.includes(ch.toUpperCase()) &&
      !isIdentifierChar(sql[i - 1])
    ) {
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

      if (opensCompoundBody(current) && !endsCompoundBody(current)) continue

      if (opensDeferredBlock(current)) continue

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
