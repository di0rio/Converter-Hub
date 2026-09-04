import { SQLSERVER_SYNTAX, unquoteIdentifier } from '../shared/syntax.js'

/**
 * Identifier and qualified-name reading for T-SQL.
 *
 * T-SQL brackets an identifier (`[x]`, with `]]` escaping a literal `]`
 * inside the name) and also accepts the standard double-quoted form. Both are
 * handled generically by `unquoteIdentifier` against `SQLSERVER_SYNTAX`; this
 * module only adds the bit that is specific to reading names out of
 * statement text — schema-qualified `[schema].[table]` references.
 */

const IDENTIFIER = String.raw`(?:\[(?:[^\]]|\]\])+\]|"(?:[^"]|"")+"|[A-Za-z_#@][A-Za-z0-9_$#@]*)`

/** `schema.table`, `[My Schema].[My Table]` or a bare name. */
export const QUALIFIED_NAME = String.raw`(${IDENTIFIER})(?:\s*\.\s*(${IDENTIFIER}))?`

export interface QualifiedName {
  /** `null` when the statement did not qualify the name with a schema. */
  schema: string | null
  name: string
}

export function unquote(raw: string): string {
  return unquoteIdentifier(raw, SQLSERVER_SYNTAX)
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
