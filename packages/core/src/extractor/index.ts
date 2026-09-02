import type {
  SqlDump,
  ExtractionOptions,
  ExtractionResult,
} from '../types/index.js'
import { describeFormat } from '../formats/index.js'

/**
 * Extract a database (or specific tables) from a parsed SQL dump,
 * producing a new SQL string.
 *
 * Every statement is reproduced exactly as the dump wrote it, so the result is
 * SQL for the engine the dump came from. This is not a dialect converter: a
 * PostgreSQL dump extracts to PostgreSQL SQL, never to MySQL SQL.
 *
 * Does not mutate the original dump.
 */
export function extractDatabase(
  dump: SqlDump,
  options: ExtractionOptions
): ExtractionResult {
  const database = dump.databases.find((d) => d.name === options.database)

  if (!database) {
    return {
      sql: '',
      database: options.database,
      tableCount: 0,
    }
  }

  // Filter tables
  const selectedTables =
    options.tables === 'all'
      ? database.tables
      : database.tables.filter((t) => options.tables.includes(t.name))

  const format = describeFormat(dump.format)

  // Build output SQL
  const lines: string[] = []

  lines.push(`-- Extracted from ${format.label} dump`)
  lines.push(`-- ${format.namespaceLabel}: ${database.name}`)
  lines.push(`-- Tables: ${selectedTables.length}`)
  lines.push('')

  // Preamble
  if (dump.preamble) {
    lines.push(dump.preamble.trimEnd())
    lines.push('')
  }

  // Database statements
  if (database.createStatement) {
    lines.push(database.createStatement.trimEnd())
  }
  if (database.useStatement) {
    lines.push(database.useStatement.trimEnd())
  }
  lines.push('')

  // Tables
  for (const table of selectedTables) {
    lines.push(`-- Table: ${table.name}`)

    if (table.createStatement) {
      lines.push(table.createStatement.trimEnd())
      const hasData =
        table.preDataStatements.length > 0 ||
        table.dataStatements.length > 0 ||
        table.postDataStatements.length > 0
      if (hasData) {
        lines.push('')
      }
    }

    for (const statement of table.preDataStatements) {
      lines.push(statement.trimEnd())
    }

    for (const statement of table.dataStatements) {
      lines.push(statement.trimEnd())
    }

    for (const statement of table.postDataStatements) {
      lines.push(statement.trimEnd())
    }

    lines.push('')
  }

  // Postamble
  if (dump.postamble) {
    lines.push(dump.postamble.trimEnd())
    lines.push('')
  }

  return {
    sql: lines.join('\n').trimEnd() + '\n',
    database: database.name,
    tableCount: selectedTables.length,
  }
}
