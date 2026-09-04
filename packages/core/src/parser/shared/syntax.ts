/**
 * Lexical rules that differ between SQL dialects.
 *
 * Only the handful of rules this project's parsers actually need are modelled
 * here — this is not a general SQL grammar.
 */

/**
 * How a dialect quotes an identifier.
 *
 * Most dialects use one character for both ends (`` `x` ``, `"x"`), which a
 * plain string describes. T-SQL brackets an identifier (`[x]`), so the two ends
 * differ and need a pair. A doubled closing character escapes itself in both
 * forms: `` `a``b` `` and `[a]]b]`.
 */
export type QuoteSpec = string | { open: string; close: string }

export interface SqlSyntax {
  /** Characters, or character pairs, that delimit a quoted identifier. */
  identifierQuotes: readonly QuoteSpec[]
  /** Whether a backslash escapes the next character inside a string literal. */
  backslashEscapes: boolean
  /**
   * Whether `<` and `>` nest, as they do in CQL's collection types
   * (`map<text, frozen<list<int>>>`). A comma inside such a type belongs to
   * the type, not to the column list.
   *
   * Only for dialects where the pair cannot also be a comparison operator —
   * everywhere else this stays off, so `CHECK (a < b)` is left alone.
   */
  angleBracketTypes?: boolean
}

/** MySQL and MariaDB: backtick identifiers, backslash escapes in strings. */
export const MYSQL_SYNTAX: SqlSyntax = {
  identifierQuotes: ['`', '"'],
  backslashEscapes: true,
}

/**
 * PostgreSQL: double-quoted identifiers only, and standard-conforming strings
 * where a backslash is an ordinary character.
 */
export const POSTGRES_SYNTAX: SqlSyntax = {
  identifierQuotes: ['"'],
  backslashEscapes: false,
}

/**
 * T-SQL: bracketed identifiers alongside the standard double-quoted form, and
 * standard strings where only a doubled quote escapes.
 */
export const SQLSERVER_SYNTAX: SqlSyntax = {
  identifierQuotes: [{ open: '[', close: ']' }, '"'],
  backslashEscapes: false,
}

/**
 * SQLite accepts every quoting style it has ever been handed: backticks and
 * brackets for MySQL and T-SQL compatibility, double quotes as standard.
 */
export const SQLITE_SYNTAX: SqlSyntax = {
  identifierQuotes: ['"', '`', { open: '[', close: ']' }],
  backslashEscapes: false,
}

/** Firebird, Oracle and Db2 all use standard double-quoted identifiers. */
export const STANDARD_SYNTAX: SqlSyntax = {
  identifierQuotes: ['"'],
  backslashEscapes: false,
}

/** CQL: standard quoting, plus angle-bracketed collection types. */
export const CQL_SYNTAX: SqlSyntax = {
  identifierQuotes: ['"'],
  backslashEscapes: false,
  angleBracketTypes: true,
}

// ------------------------------------------------------------- quoting

/** The character that closes `spec`. */
function closerOf(spec: QuoteSpec): string {
  return typeof spec === 'string' ? spec : spec.close
}

/** The character that opens `spec`. */
function openerOf(spec: QuoteSpec): string {
  return typeof spec === 'string' ? spec : spec.open
}

/**
 * The closing character for an identifier quote opened by `ch`, or null when
 * `ch` does not open one.
 */
export function identifierCloserFor(
  syntax: SqlSyntax,
  ch: string,
): string | null {
  for (const spec of syntax.identifierQuotes) {
    if (openerOf(spec) === ch) return closerOf(spec)
  }
  return null
}

/**
 * Return the body of a parenthesised clause starting at `openIndex`,
 * respecting nesting, string literals and quoted identifiers.
 */
export function readBalanced(
  sql: string,
  openIndex: number,
  syntax: SqlSyntax,
): string {
  let depth = 0
  // The character that will close the literal or identifier currently open.
  let closer: string | null = null

  for (let i = openIndex; i < sql.length; i++) {
    const ch = sql[i] as string

    if (closer !== null) {
      if (ch === '\\' && syntax.backslashEscapes) {
        i++
      } else if (ch === closer) {
        if (sql[i + 1] === closer) i++
        else closer = null
      }
      continue
    }

    if (ch === "'") {
      closer = "'"
      continue
    }

    const identifierCloser = identifierCloserFor(syntax, ch)
    if (identifierCloser !== null) {
      closer = identifierCloser
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
export function splitTopLevel(body: string, syntax: SqlSyntax): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let closer: string | null = null

  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string

    if (closer !== null) {
      current += ch
      if (ch === '\\' && syntax.backslashEscapes) {
        if (i + 1 < body.length) current += body[++i]
      } else if (ch === closer) {
        if (body[i + 1] === closer) current += body[++i]
        else closer = null
      }
      continue
    }

    if (ch === "'") {
      closer = "'"
      current += ch
      continue
    }

    const identifierCloser = identifierCloserFor(syntax, ch)
    if (identifierCloser !== null) {
      closer = identifierCloser
      current += ch
      continue
    }

    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (syntax.angleBracketTypes === true) {
      // A collection type nests the same way parentheses do.
      if (ch === '<') depth++
      else if (ch === '>' && depth > 0) depth--
    }

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
 * Strip leading comment lines from a statement, returning the remaining SQL.
 * Handles --, # and block comments at the start of a statement.
 */
export function stripLeadingComments(sql: string): string {
  let rest = sql.trimStart()

  while (true) {
    if (rest.startsWith('--') || rest.startsWith('#')) {
      const newlineIdx = rest.indexOf('\n')
      rest = newlineIdx === -1 ? '' : rest.slice(newlineIdx + 1)
      rest = rest.trimStart()
      continue
    }

    if (rest.startsWith('/*')) {
      const endIdx = rest.indexOf('*/')
      rest = endIdx === -1 ? '' : rest.slice(endIdx + 2)
      rest = rest.trimStart()
      continue
    }

    break
  }

  return rest
}

/** Remove one layer of identifier quoting, undoubling any escaped quote. */
export function unquoteIdentifier(raw: string, syntax: SqlSyntax): string {
  const value = raw.trim()
  const first = value[0]
  if (first === undefined || value.length < 2) return value

  const closer = identifierCloserFor(syntax, first)
  if (closer !== null && value.endsWith(closer)) {
    return value
      .slice(1, -1)
      .split(closer + closer)
      .join(closer)
  }

  return value
}
