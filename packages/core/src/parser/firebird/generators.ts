import { stripLeadingComments } from '../shared/syntax.js'
import { IDENT, normalizeKey } from './identifiers.js'

/**
 * Which table each generator belongs to, read from the triggers that use it.
 *
 * Firebird has no `GENERATED ALWAYS AS IDENTITY`: a script auto-increments a
 * column with a standalone `CREATE GENERATOR` (or, since 3.0, `CREATE
 * SEQUENCE`) plus a `BEFORE INSERT` trigger that calls `GEN_ID(gen, 1)` or
 * `NEXT VALUE FOR gen`. The generator's own statement carries no reference to
 * the table — only the trigger connects them — so the whole script has to be
 * scanned for trigger bodies before generators can be attached to anything.
 *
 * Returns generator name (normalised key) -> owning table name, raw as the
 * trigger wrote it. A generator no trigger references is left unmapped, and
 * the caller parks its CREATE statement instead of attaching it.
 */
export function findGeneratorOwners(statements: string[]): Map<string, string> {
  const owners = new Map<string, string>()

  const triggerHeader = new RegExp(
    String.raw`^CREATE\s+(?:OR\s+ALTER\s+)?TRIGGER\s+${IDENT}\s+FOR\s+(${IDENT})`,
    'i',
  )
  const genIdCall = new RegExp(String.raw`GEN_ID\s*\(\s*(${IDENT})\s*,`, 'gi')
  const nextValueFor = new RegExp(
    String.raw`NEXT\s+VALUE\s+FOR\s+(${IDENT})`,
    'gi',
  )

  for (const stmt of statements) {
    const clean = stripLeadingComments(stmt)
    const header = triggerHeader.exec(clean)
    if (!header) continue

    const table = header[1] as string
    for (const match of clean.matchAll(genIdCall)) {
      owners.set(normalizeKey(match[1] as string), table)
    }
    for (const match of clean.matchAll(nextValueFor)) {
      owners.set(normalizeKey(match[1] as string), table)
    }
  }

  return owners
}
