import { STANDARD_SYNTAX, unquoteIdentifier } from './syntax.js'

const IDENTIFIER = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$#]*)`

export const QUALIFIED_NAME = String.raw`(${IDENTIFIER})(?:\s*\.\s*(${IDENTIFIER}))?`

export interface QualifiedName {
  schema: string | null
  name: string
}

export function unquote(raw: string): string {
  return unquoteIdentifier(raw, STANDARD_SYNTAX)
}

export function qualifiedNameAfter(
  sql: string,
  prefix: string,
): QualifiedName | null {
  const match = new RegExp(prefix + String.raw`\s*` + QUALIFIED_NAME, 'i').exec(
    sql,
  )
  if (!match) return null

  const first = unquote(match[1] as string)
  const second = match[2] ? unquote(match[2]) : null

  return second !== null
    ? { schema: first, name: second }
    : { schema: null, name: first }
}
