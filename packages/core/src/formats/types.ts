/**
 * Every database format the project knows about — including the ones it
 * deliberately does not read.
 *
 * Being listed here is not a claim of support. `FormatDescriptor.status` is,
 * and only `supported` may be advertised to a user.
 */
export type DatabaseFormat =
  // MySQL family
  | 'mysql'
  | 'mariadb'
  | 'tidb'
  // PostgreSQL family
  | 'postgresql'
  | 'cockroachdb'
  | 'yugabytedb'
  | 'greenplum'
  | 'redshift'
  | 'timescaledb'
  | 'citus'
  // SQL Server family
  | 'sqlserver'
  | 'synapse'
  // Embedded
  | 'sqlite'
  | 'duckdb'
  // Standalone dialects
  | 'firebird'
  | 'oracle'
  | 'db2'
  // Evaluated, no local dump format
  | 'snowflake'
  | 'bigquery'
  | 'databricks'
  | 'trino'
  | 'presto'
  | 'hive'
  | 'impala'

/**
 * How far a format actually got.
 *
 * - `supported`      — parser, detection, fixture and tests all pass. Advertised.
 * - `experimental`   — parses real dumps, but with known gaps. Not advertised.
 * - `planned`        — declared so detection can name it; no parser yet.
 * - `not_applicable` — the product has no local SQL dump this tool could read.
 *
 * Anything below `supported` stays out of the UI's format list. The status is
 * what keeps the advertised list and the implementation from drifting apart.
 */
export type SupportStatus = 'supported' | 'experimental' | 'planned' | 'not_applicable'

/**
 * What a format calls the grouping a user picks from.
 *
 * MySQL and MariaDB group tables by database; PostgreSQL by schema inside a
 * database. SQLite has exactly one, and calls it `main` — that is SQLite's own
 * word, not a name invented here, so it is a `database` like any other.
 */
export type NamespaceKind = 'database' | 'schema'

/**
 * The parser infrastructure a format reuses.
 *
 * A family means shared lexical rules, never an assumption that two products
 * are interchangeable: a format only claims a family after its own fixture
 * proves the shared reader handles it.
 */
export type DialectFamily =
  | 'mysql'
  | 'postgresql'
  | 'sqlserver'
  | 'sqlite'
  | 'firebird'
  | 'oracle'
  | 'db2'
  | 'none'

export interface FormatDescriptor {
  id: DatabaseFormat
  /** Name to show a user. */
  label: string
  status: SupportStatus
  family: DialectFamily
  namespace: NamespaceKind
  /** Capitalised singular of `namespace`, for headings. */
  namespaceLabel: string
  /**
   * Markers only this format's dump tool writes.
   *
   * Nothing merely idiomatic belongs here. A marker that a sibling in the same
   * family also emits cannot separate the two and must not be listed.
   */
  markers: RegExp[]
  /**
   * Honest qualifier shown in docs: what is limited for an `experimental`
   * format, or why a `not_applicable` one is not readable. Required for both.
   */
  note?: string
}
