export type QuoteSpec = string | { open: string; close: string }

export interface SqlSyntax {
  identifierQuotes: readonly QuoteSpec[]
  backslashEscapes: boolean
  angleBracketTypes?: boolean
}

export const MYSQL_SYNTAX: SqlSyntax = {
  identifierQuotes: ['`', '"'],
  backslashEscapes: true,
}

export const POSTGRES_SYNTAX: SqlSyntax = {
  identifierQuotes: ['"'],
  backslashEscapes: false,
}

export const SQLSERVER_SYNTAX: SqlSyntax = {
  identifierQuotes: [{ open: '[', close: ']' }, '"'],
  backslashEscapes: false,
}

export const SQLITE_SYNTAX: SqlSyntax = {
  identifierQuotes: ['"', '`', { open: '[', close: ']' }],
  backslashEscapes: false,
}

export const STANDARD_SYNTAX: SqlSyntax = {
  identifierQuotes: ['"'],
  backslashEscapes: false,
}

export const CQL_SYNTAX: SqlSyntax = {
  identifierQuotes: ['"'],
  backslashEscapes: false,
  angleBracketTypes: true,
}

function closerOf(spec: QuoteSpec): string {
  return typeof spec === 'string' ? spec : spec.close
}

function openerOf(spec: QuoteSpec): string {
  return typeof spec === 'string' ? spec : spec.open
}

export function identifierCloserFor(
  syntax: SqlSyntax,
  ch: string,
): string | null {
  for (const spec of syntax.identifierQuotes) {
    if (openerOf(spec) === ch) return closerOf(spec)
  }
  return null
}

export function readBalanced(
  sql: string,
  openIndex: number,
  syntax: SqlSyntax,
): string {
  let depth = 0
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
