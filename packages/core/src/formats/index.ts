import type {
  DatabaseFormat,
  DialectFamily,
  FormatDescriptor,
  SupportStatus,
} from './types.js'
import { CATALOG, FAMILY_DEFAULT, FAMILY_MARKERS } from './catalog.js'

export type {
  DatabaseFormat,
  DialectFamily,
  FormatDescriptor,
  NamespaceKind,
  SupportStatus,
} from './types.js'
export { CATALOG, FAMILY_MARKERS, FAMILY_DEFAULT } from './catalog.js'

export const DATABASE_FORMATS = CATALOG

const ALL_FORMATS: FormatDescriptor[] = Object.values(CATALOG)

export const SUPPORTED_FORMATS: FormatDescriptor[] = ALL_FORMATS.filter(
  (format) => format.status === 'supported',
)

export const EXPERIMENTAL_FORMATS: FormatDescriptor[] = ALL_FORMATS.filter(
  (format) => format.status === 'experimental',
)

export function allFormats(): FormatDescriptor[] {
  return ALL_FORMATS
}

export function formatsWithStatus(status: SupportStatus): FormatDescriptor[] {
  return ALL_FORMATS.filter((format) => format.status === status)
}

export function describeFormat(format: DatabaseFormat): FormatDescriptor {
  return CATALOG[format]
}

export function isDatabaseFormat(value: string): value is DatabaseFormat {
  return Object.prototype.hasOwnProperty.call(CATALOG, value)
}

export function isReadable(format: DatabaseFormat): boolean {
  const status = CATALOG[format].status
  return status === 'supported' || status === 'experimental'
}

export type FormatConfidence = 'detected' | 'assumed'

export type FormatDetection =
  | { format: DatabaseFormat; confidence: FormatConfidence }
  | { format: null; confidence: null }

const GENERIC_SQL = /\b(CREATE\s+TABLE|INSERT\s+INTO)\b/i

const DECISIVE_LEAD = 2

const FAMILIES = Object.keys(FAMILY_MARKERS) as DialectFamily[]

function countMatches(sql: string, markers: RegExp[]): number {
  let hits = 0
  for (const marker of markers) {
    if (marker.test(sql)) hits++
  }
  return hits
}

function memberOf(
  family: DialectFamily,
  sql: string,
): { format: DatabaseFormat | null; hits: number } {
  let best: DatabaseFormat | null = null
  let bestHits = 0

  for (const descriptor of ALL_FORMATS) {
    if (descriptor.family !== family || descriptor.markers.length === 0)
      continue

    const hits = countMatches(sql, descriptor.markers)
    if (hits > bestHits) {
      best = descriptor.id
      bestHits = hits
    }
  }

  return { format: best ?? FAMILY_DEFAULT[family], hits: bestHits }
}

export function detectFormat(sql: string): FormatDetection {
  const scores = FAMILIES.filter((family) => family !== 'none')
    .map((family) => {
      const member = memberOf(family, sql)
      return {
        family,
        member: member.format,
        hits: countMatches(sql, FAMILY_MARKERS[family]) + member.hits,
      }
    })
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits)

  if (scores.length > 0) {
    const leader = scores[0]
    const runnerUp = scores[1]

    if (runnerUp !== undefined && leader.hits - runnerUp.hits < DECISIVE_LEAD) {
      return { format: null, confidence: null }
    }

    if (leader.member !== null) {
      return { format: leader.member, confidence: 'detected' }
    }
  }

  if (GENERIC_SQL.test(sql)) {
    return { format: 'mysql', confidence: 'assumed' }
  }

  return { format: null, confidence: null }
}
