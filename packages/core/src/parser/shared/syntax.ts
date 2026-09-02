/**
 * Lexical rules that differ between SQL dialects.
 *
 * Only the handful of rules this project's parsers actually need are modelled
 * here — this is not a general SQL grammar.
 */
export interface SqlSyntax {
  /** Characters that open and close a quoted identifier. */
  identifierQuotes: readonly string[]
  /** Whether a backslash escapes the next character inside a string literal. */
  backslashEscapes: boolean
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
 * Return the body of a parenthesised clause starting at `openIndex`,
 * respecting nesting, string literals and quoted identifiers.
 */
export function readBalanced(
  sql: string,
  openIndex: number,
  syntax: SqlSyntax,
): string {
  let depth = 0
  let quote: string | null = null

  for (let i = openIndex; i < sql.length; i++) {
    const ch = sql[i]

    if (quote) {
      if (ch === '\\' && syntax.backslashEscapes) {
        i++
      } else if (ch === quote) {
        if (sql[i + 1] === quote) i++
        else quote = null
      }
      continue
    }

    if (ch === "'" || syntax.identifierQuotes.includes(ch as string)) {
      quote = ch as string
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
  let quote: string | null = null

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]

    if (quote) {
      current += ch
      if (ch === '\\' && syntax.backslashEscapes) {
        if (i + 1 < body.length) current += body[++i]
      } else if (ch === quote) {
        if (body[i + 1] === quote) current += body[++i]
        else quote = null
      }
      continue
    }

    if (ch === "'" || syntax.identifierQuotes.includes(ch as string)) {
      quote = ch as string
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
  const quote = value[0]

  if (
    value.length >= 2 &&
    quote !== undefined &&
    syntax.identifierQuotes.includes(quote) &&
    value.endsWith(quote)
  ) {
    return value.slice(1, -1).split(quote + quote).join(quote)
  }

  return value
}
