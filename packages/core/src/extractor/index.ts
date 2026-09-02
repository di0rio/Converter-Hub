import type {
  SqlDump,
  ExtractionOptions,
  ExtractionResult,
} from '../types/index.js'

/**
 * Extract a database (or specific tables) from a parsed SQL dump,
 * producing a new SQL string.
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

  // Build output SQL
  const lines: string[] = []

  lines.push('-- Extracted from SQL dump')
  lines.push(`-- Database: ${database.name}`)
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
      const hasData = table.lockStatement || table.insertStatements.length > 0 || table.unlockStatement
      if (hasData) {
        lines.push('')
      }
    }

    if (table.lockStatement) {
      lines.push(table.lockStatement.trimEnd())
    }

    for (const insert of table.insertStatements) {
      lines.push(insert.trimEnd())
    }

    if (table.unlockStatement) {
      lines.push(table.unlockStatement.trimEnd())
    }

    for (const index of table.indexes) {
      lines.push(index.trimEnd())
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
