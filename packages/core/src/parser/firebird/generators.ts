import { stripLeadingComments } from '../shared/syntax.js'
import { IDENT, normalizeKey } from './identifiers.js'

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
