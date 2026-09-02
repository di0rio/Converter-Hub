import type { DatabaseFormat } from '../formats/index.js'
import { detectFormat } from '../formats/index.js'
import type { SqlDump } from '../types/index.js'
import type { FormatParser } from './shared/format-parser.js'
import { createMysqlParser } from './mysql/index.js'
import { postgresParser } from './postgresql/index.js'

/**
 * Every format this project can read.
 *
 * Adding an engine means adding one entry here and one parser module. Nothing
 * else in the application dispatches on format.
 */
const PARSERS: Record<DatabaseFormat, FormatParser> = {
  mysql: createMysqlParser('mysql'),
  mariadb: createMysqlParser('mariadb'),
  postgresql: postgresParser,
}

export function getParser(format: DatabaseFormat): FormatParser {
  return PARSERS[format]
}

/**
 * The file is not a dump this project can read.
 *
 * The message is deliberately short and carries none of the input: no SQL, no
 * paths, nothing about the parser. It is safe to show a user as-is.
 */
export class UnsupportedFormatError extends Error {
  constructor() {
    super('Unsupported database format.')
    this.name = 'UnsupportedFormatError'
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

  return PARSERS[format].parse(sql)
}
