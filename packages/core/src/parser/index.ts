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

const PARSERS: Partial<Record<DatabaseFormat, FormatParser>> = {
  mysql: createMysqlParser('mysql'),
  mariadb: createMysqlParser('mariadb'),
  tidb: createMysqlParser('tidb'),
  percona: createMysqlParser('percona'),
  'aurora-mysql': createMysqlParser('aurora-mysql'),
  singlestore: createMysqlParser('singlestore'),
  starrocks: createMysqlParser('starrocks'),

  postgresql: createPostgresParser('postgresql'),
  cockroachdb: createPostgresParser('cockroachdb'),
  yugabytedb: createPostgresParser('yugabytedb'),
  greenplum: createPostgresParser('greenplum'),
  redshift: createPostgresParser('redshift'),
  timescaledb: createPostgresParser('timescaledb'),
  citus: createPostgresParser('citus'),
  enterprisedb: createPostgresParser('enterprisedb'),

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

export function findParser(format: DatabaseFormat): FormatParser | null {
  return PARSERS[format] ?? null
}

export function getParser(format: DatabaseFormat): FormatParser {
  const parser = PARSERS[format]
  if (!parser) throw new UnsupportedFormatError(format)
  return parser
}

export function readableFormats(): DatabaseFormat[] {
  return Object.keys(PARSERS) as DatabaseFormat[]
}

export class UnsupportedFormatError extends Error {
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
  format?: DatabaseFormat
}

export function parseDump(sql: string, options: ParseOptions = {}): SqlDump {
  const format = options.format ?? detectFormat(sql).format
  if (format === null) throw new UnsupportedFormatError()

  const parser = PARSERS[format]
  if (!parser) {
    throw new UnsupportedFormatError(
      CATALOG[format].status === 'not_applicable' ? null : format,
    )
  }

  return parser.parse(sql)
}
