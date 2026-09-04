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

/** Every format the project knows about, including the ones it cannot read. */
export const DATABASE_FORMATS = CATALOG

const ALL_FORMATS: FormatDescriptor[] = Object.values(CATALOG)

/**
 * The formats a user may be told about.
 *
 * Only `supported` qualifies: a parser exists, a synthetic fixture exercises
 * it, and its tests pass. This list is what the UI and the CLI advertise, so
 * a format cannot be promoted here without the work behind it.
 */
export const SUPPORTED_FORMATS: FormatDescriptor[] = ALL_FORMATS.filter(
  (format) => format.status === 'supported',
)

/** Formats readable with known gaps. Documented, never advertised. */
export const EXPERIMENTAL_FORMATS: FormatDescriptor[] = ALL_FORMATS.filter(
  (format) => format.status === 'experimental',
)

/** Everything the catalog holds, for the compatibility matrix and the docs. */
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

/** Whether this project can actually read the format, gaps included. */
export function isReadable(format: DatabaseFormat): boolean {
  const status = CATALOG[format].status
  return status === 'supported' || status === 'experimental'
}

// ----------------------------------------------------------- detection

/**
 * How much the detector actually knows.
 *
 * `detected` means dialect-specific markers were found. `assumed` means the
 * file is recognisable SQL but carries nothing that identifies an engine, so
 * a format was picked rather than recognised — callers should say so rather
 * than claim a detection.
 */
export type FormatConfidence = 'detected' | 'assumed'

export type FormatDetection =
  | { format: DatabaseFormat; confidence: FormatConfidence }
  /** The text is not a SQL dump this project can read. */
  | { format: null; confidence: null }

/** Enough SQL to be worth parsing at all. */
const GENERIC_SQL = /\b(CREATE\s+TABLE|INSERT\s+INTO)\b/i

/**
 * How far ahead one family must be before its markers outweigh another's.
 *
 * A stray backtick inside a PostgreSQL value, or the word GO inside a comment,
 * should not flip the answer — but neither should a genuine majority be
 * discarded. Two clear markers is the margin.
 */
const DECISIVE_LEAD = 2

const FAMILIES = Object.keys(FAMILY_MARKERS) as DialectFamily[]

function countMatches(sql: string, markers: RegExp[]): number {
  let hits = 0
  for (const marker of markers) {
    if (marker.test(sql)) hits++
  }
  return hits
}

/**
 * The member of `family` the dump names, and how strongly.
 *
 * Members are ranked by their own markers, which are the ones a sibling does
 * not write. A tie means nothing separated them, so the family default wins
 * rather than an arbitrary pick.
 */
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

/**
 * Identify the engine that produced a dump.
 *
 * Deliberately conservative: a family is only named when its markers clearly
 * outweigh every other family's, so contradictory evidence yields no answer
 * instead of a guess. Generic SQL that no dump tool would have written — a
 * hand-authored CREATE TABLE plus INSERTs — is reported as `assumed`, never as
 * a detection.
 *
 * A format that is merely `planned` can still be named here. That is the point:
 * saying "this looks like a SQL Server dump, which is not supported yet" is
 * more useful than refusing to place the file at all. Callers decide what to do
 * with a format that has no parser.
 */
export function detectFormat(sql: string): FormatDetection {
  const scores = FAMILIES.filter((family) => family !== 'none')
    .map((family) => {
      const member = memberOf(family, sql)
      // A product's own markers are evidence for its family too. Without this,
      // a dump that names no family-wide signal — Redshift DDL says DISTKEY and
      // SORTKEY but never writes a pg_dump banner — scores zero for the family
      // that can actually read it.
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

    // Markers from more than one family. Name one only when it is clearly ahead.
    if (runnerUp !== undefined && leader.hits - runnerUp.hits < DECISIVE_LEAD) {
      return { format: null, confidence: null }
    }

    if (leader.member !== null) {
      return { format: leader.member, confidence: 'detected' }
    }
  }

  // No engine markers at all. Plain SQL still parses under the MySQL reader,
  // whose syntax is a superset of what a portable dump uses.
  if (GENERIC_SQL.test(sql)) {
    return { format: 'mysql', confidence: 'assumed' }
  }

  return { format: null, confidence: null }
}
