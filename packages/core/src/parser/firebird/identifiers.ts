import { FIREBIRD_DIALECT } from '../shared/dialect.js'
import { unquoteIdentifier } from '../shared/syntax.js'

/**
 * Identifier matching for Firebird scripts.
 *
 * Firebird uses standard double-quoted identifiers only (`"Full Name"`); an
 * unquoted identifier is case-insensitive at the engine, folded to upper case
 * internally. This project never folds a name for display — a script that
 * writes `Authors` keeps reading `Authors` — but matching an unquoted name
 * against another spelling (a trigger's `FOR authors` against a `CREATE TABLE
 * AUTHORS`) has to compare case-insensitively to behave the way the engine
 * does. `normalizeKey` is that comparison; `displayName` is what a reader
 * sees.
 */

/** One identifier: a `"quoted"` run (doubled quote escapes) or a bare word. */
export const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`

/** The identifier immediately following `prefix`, unmatched if none is there. */
export function identAfter(sql: string, prefix: string): string | null {
  const match = new RegExp(prefix + String.raw`\s*(` + IDENT + ')', 'i').exec(
    sql,
  )
  return match ? (match[1] as string) : null
}

/** The name a reader sees: quoting removed, case exactly as the script wrote it. */
export function displayName(raw: string): string {
  return unquoteIdentifier(raw, FIREBIRD_DIALECT.syntax)
}

/**
 * A comparison key for identifier equality under Firebird's folding rules: a
 * quoted identifier is case-sensitive, an unquoted one is not.
 */
export function normalizeKey(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.startsWith('"')
    ? 'Q:' + displayName(trimmed)
    : 'U:' + trimmed.toUpperCase()
}
