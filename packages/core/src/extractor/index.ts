import type {
  SqlDump,
  ExtractionOptions,
  ExtractionResult,
} from '../types/index.js'
import { describeFormat } from '../formats/index.js'

export function extractDatabase(
  dump: SqlDump,
  options: ExtractionOptions,
): ExtractionResult {
  const database = dump.databases.find((d) => d.name === options.database)

  if (!database) {
    return {
      sql: '',
      database: options.database,
      tableCount: 0,
    }
  }

  const selectedTables =
    options.tables === 'all'
      ? database.tables
      : database.tables.filter((t) => options.tables.includes(t.name))

  const format = describeFormat(dump.format)

  const lines: string[] = []

  lines.push(`-- Extracted from ${format.label} dump`)
  lines.push(`-- ${format.namespaceLabel}: ${database.name}`)
  lines.push(`-- Tables: ${selectedTables.length}`)
  lines.push('')

  if (dump.preamble) {
    lines.push(dump.preamble.trimEnd())
    lines.push('')
  }

  if (database.createStatement) {
    lines.push(database.createStatement.trimEnd())
  }
  if (database.useStatement) {
    lines.push(database.useStatement.trimEnd())
  }
  lines.push('')

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
