import type { DatabaseFormat } from '../formats/index.js'
import { CATALOG, describeFormat, detectFormat } from '../formats/index.js'
import type { SqlDump } from '../types/index.js'
import type { FormatParser } from './shared/format-parser.js'
import { createMysqlParser } from './mysql/index.js'
import { createPostgresParser } from './postgresql/index.js'
import { createSqliteParser } from './sqlite/index.js'
import { createSqlServerParser } from './sqlserver/index.js'
import { firebirdParser } from './firebird/index.js'
import { oracleParser } from './oracle/index.js'
import { db2Parser } from './db2/index.js'
import { cassandraParser } from './cassandra/index.js'
import { mongodbParser } from './mongodb/index.js'
import { elasticsearchParser } from './elasticsearch/index.js'
import { neo4jParser } from './neo4j/index.js'

/**
 * The formats that actually have a reader.
 *
 * The catalog lists every format the project knows about; this map lists the
 * ones it can parse. A format declared in the catalog but absent here is
 * recognisable but not readable, which is exactly what `status: 'planned'`
 * means. Adding an engine means adding one entry here and one parser module —
 * nothing else in the application dispatches on format.
 */
const PARSERS: Partial<Record<DatabaseFormat, FormatParser>> = {
  // MySQL family — one reader, one identity each.
  mysql: createMysqlParser('mysql'),
  mariadb: createMysqlParser('mariadb'),
  tidb: createMysqlParser('tidb'),
  percona: createMysqlParser('percona'),
  'aurora-mysql': createMysqlParser('aurora-mysql'),
  singlestore: createMysqlParser('singlestore'),
  starrocks: createMysqlParser('starrocks'),

  // PostgreSQL family. Sharing the reader is not the same as being the same
  // product: each keeps its own format stamp so a Greenplum dump is reported
  // as Greenplum rather than silently relabelled PostgreSQL.
  postgresql: createPostgresParser('postgresql'),
  cockroachdb: createPostgresParser('cockroachdb'),
  yugabytedb: createPostgresParser('yugabytedb'),
  greenplum: createPostgresParser('greenplum'),
  redshift: createPostgresParser('redshift'),
  timescaledb: createPostgresParser('timescaledb'),
  citus: createPostgresParser('citus'),
  enterprisedb: createPostgresParser('enterprisedb'),

  // Dialects with readers of their own.
  sqlite: createSqliteParser('sqlite'),
  duckdb: createSqliteParser('duckdb'),
  sqlserver: createSqlServerParser('sqlserver'),
  synapse: createSqlServerParser('synapse'),
  firebird: firebirdParser,
  oracle: oracleParser,
  db2: db2Parser,
  cassandra: cassandraParser,
  mongodb: mongodbParser,
  elasticsearch: elasticsearchParser,
  neo4j: neo4jParser,
}

/** The reader for a format, or null when the format has no parser yet. */
export function findParser(format: DatabaseFormat): FormatParser | null {
  return PARSERS[format] ?? null
}

/**
 * The reader for a format.
 *
 * Callers that already hold a parsed table know a parser exists, since the
 * table could not have been produced without one.
 */
export function getParser(format: DatabaseFormat): FormatParser {
  const parser = PARSERS[format]
  if (!parser) throw new UnsupportedFormatError(format)
  return parser
}

/** Every format that can be parsed right now. */
export function readableFormats(): DatabaseFormat[] {
  return Object.keys(PARSERS) as DatabaseFormat[]
}

/**
 * The file is not a dump this project can read.
 *
 * The message carries none of the input: no SQL, no paths, nothing about the
 * parser. Naming a recognised-but-unsupported engine is deliberate — telling
 * someone their SQL Server dump is not supported yet is more useful than
 * refusing to place the file — and the engine name comes from the catalog, not
 * from the file's contents. Safe to show a user as-is.
 */
export class UnsupportedFormatError extends Error {
  /** The format that was recognised but cannot be read, when one was. */
  readonly format: DatabaseFormat | null

  constructor(format: DatabaseFormat | null = null) {
    super(
      format === null
        ? 'Unsupported database format.'
        : `${describeFormat(format).label} dumps are not supported yet.`,
    )
    this.name = 'UnsupportedFormatError'
    this.format = format
  }
}

export interface ParseOptions {
  /** Skip detection and read the dump as this format. */
  format?: DatabaseFormat
}

/**
 * Parse a database dump into the normalised model.
 *
 * With no explicit format the source engine is detected from the dump's own
 * markers; a file with nothing recognisable in it is rejected rather than
 * guessed at. The SQL is only ever read as text — never executed.
 */
export function parseDump(sql: string, options: ParseOptions = {}): SqlDump {
  const format = options.format ?? detectFormat(sql).format
  if (format === null) throw new UnsupportedFormatError()

  const parser = PARSERS[format]
  if (!parser) {
    // Recognised, but nothing can read it. Say which engine, not why.
    throw new UnsupportedFormatError(
      CATALOG[format].status === 'not_applicable' ? null : format,
    )
  }

  return parser.parse(sql)
}
