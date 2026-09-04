import { STANDARD_SYNTAX, unquoteIdentifier } from './syntax.js'

/**
 * Reading schema-qualified names out of statements written in standard SQL
 * identifier syntax — `"Quoted Name"` or a bare word.
 *
 * Oracle, Db2 and Cassandra all quote identifiers the same way, so the three
 * share this rather than each carrying its own copy. MySQL (backticks) and
 * T-SQL (brackets) have their own, because their quoting differs.
 */

const IDENTIFIER = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$#]*)`

/** `schema.table`, `"My Schema"."My Table"` or a bare name. */
export const QUALIFIED_NAME = String.raw`(${IDENTIFIER})(?:\s*\.\s*(${IDENTIFIER}))?`

export interface QualifiedName {
  /** `null` when the statement did not qualify the name with a schema. */
  schema: string | null
  name: string
}

export function unquote(raw: string): string {
  return unquoteIdentifier(raw, STANDARD_SYNTAX)
}

/** Read the qualified name that follows `prefix` in a statement. */
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
