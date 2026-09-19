import { FIREBIRD_DIALECT } from '../shared/dialect.js'
import { unquoteIdentifier } from '../shared/syntax.js'

export const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`

export function identAfter(sql: string, prefix: string): string | null {
  const match = new RegExp(prefix + String.raw`\s*(` + IDENT + ')', 'i').exec(
    sql,
  )
  return match ? (match[1] as string) : null
}

export function displayName(raw: string): string {
  return unquoteIdentifier(raw, FIREBIRD_DIALECT.syntax)
}

export function normalizeKey(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.startsWith('"')
    ? 'Q:' + displayName(trimmed)
    : 'U:' + trimmed.toUpperCase()
}
