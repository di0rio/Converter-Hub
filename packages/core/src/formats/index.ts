/**
 * The database engines whose dumps this project can actually read.
 *
 * A format only belongs here once a parser exists for it and that parser is
 * covered by tests — this list is what the UI advertises.
 */
export type DatabaseFormat = 'mysql' | 'mariadb' | 'postgresql'

/**
 * What a format calls the grouping a user picks from.
 *
 * MySQL and MariaDB group tables by database. PostgreSQL groups them by schema
 * inside a database, so calling a PostgreSQL grouping a "database" would be
 * wrong in the UI even though the parsed shape is the same.
 */
export type NamespaceKind = 'database' | 'schema'

export interface FormatDescriptor {
  id: DatabaseFormat
  /** Name to show a user. */
  label: string
  namespace: NamespaceKind
  /** Capitalised singular of `namespace`, for headings. */
  namespaceLabel: string
}

export const DATABASE_FORMATS: Record<DatabaseFormat, FormatDescriptor> = {
  mysql: {
    id: 'mysql',
    label: 'MySQL',
    namespace: 'database',
    namespaceLabel: 'Database',
  },
  mariadb: {
    id: 'mariadb',
    label: 'MariaDB',
    namespace: 'database',
    namespaceLabel: 'Database',
  },
  postgresql: {
    id: 'postgresql',
    label: 'PostgreSQL',
    namespace: 'schema',
    namespaceLabel: 'Schema',
  },
}

export const SUPPORTED_FORMATS: FormatDescriptor[] = [
  DATABASE_FORMATS.mysql,
  DATABASE_FORMATS.mariadb,
  DATABASE_FORMATS.postgresql,
]

export function describeFormat(format: DatabaseFormat): FormatDescriptor {
  return DATABASE_FORMATS[format]
}

export function isDatabaseFormat(value: string): value is DatabaseFormat {
  return Object.prototype.hasOwnProperty.call(DATABASE_FORMATS, value)
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

/**
 * Markers that only one engine's dump tool emits. Nothing merely idiomatic
 * belongs in these lists.
 */
const MYSQL_MARKERS: RegExp[] = [
  /\/\*!\d{5}/, // /*!40101 SET ... */ version-gated comments
  /^--\s*MySQL dump/im,
  /\bLOCK TABLES\b/i,
  /\bUNLOCK TABLES\b/i,
  /\bENGINE\s*=\s*[A-Za-z]+/i,
  /\bAUTO_INCREMENT\b/i,
  /\bDEFAULT CHARSET\s*=/i,
  /`[^`\n]+`/, // backtick-quoted identifier
]

/** MariaDB dumps are MySQL dumps plus these. */
const MARIADB_MARKERS: RegExp[] = [
  /^--\s*MariaDB dump/im,
  /\/\*M!\d{5}/,
  /^--.*\bMariaDB\b/im,
]

const POSTGRES_MARKERS: RegExp[] = [
  /^--\s*PostgreSQL database dump/im,
  /^\\connect\b/im,
  /\bFROM stdin;/i,
  /^\\\.$/m, // COPY data terminator
  /\bSET search_path\b/i,
  /\bstandard_conforming_strings\b/i,
  /\bOWNER TO\b/i,
  /\bpg_catalog\./i,
]

/** Enough SQL to be worth parsing at all. */
const GENERIC_SQL = /\b(CREATE\s+TABLE|INSERT\s+INTO)\b/i

function countMatches(sql: string, markers: RegExp[]): number {
  let hits = 0
  for (const marker of markers) {
    if (marker.test(sql)) hits++
  }
  return hits
}

/** MariaDB dumps are MySQL dumps, so only its own markers separate the two. */
function mysqlFamily(sql: string): DatabaseFormat {
  return countMatches(sql, MARIADB_MARKERS) > 0 ? 'mariadb' : 'mysql'
}

/**
 * Identify the engine that produced a dump.
 *
 * Deliberately conservative: a format is only named when markers unique to it
 * are present and no other format's markers contradict them. Generic SQL that
 * no dump tool would have written — a hand-authored CREATE TABLE plus INSERTs
 * — is reported as `assumed`, never as a detection.
 */
export function detectFormat(sql: string): FormatDetection {
  const mysqlHits = countMatches(sql, MYSQL_MARKERS)
  const postgresHits = countMatches(sql, POSTGRES_MARKERS)

  // Markers from two engines at once. A stray backtick inside a PostgreSQL
  // value should not flip the answer, so name a format only when one side is
  // clearly ahead.
  if (mysqlHits > 0 && postgresHits > 0) {
    if (postgresHits - mysqlHits >= 2) {
      return { format: 'postgresql', confidence: 'detected' }
    }
    if (mysqlHits - postgresHits >= 2) {
      return { format: mysqlFamily(sql), confidence: 'detected' }
    }
    return { format: null, confidence: null }
  }

  if (postgresHits > 0) {
    return { format: 'postgresql', confidence: 'detected' }
  }

  if (mysqlHits > 0) {
    return { format: mysqlFamily(sql), confidence: 'detected' }
  }

  // No engine markers at all. Plain SQL still parses under the MySQL reader,
  // whose syntax is a superset of what a portable dump uses.
  if (GENERIC_SQL.test(sql)) {
    return { format: 'mysql', confidence: 'assumed' }
  }

  return { format: null, confidence: null }
}
