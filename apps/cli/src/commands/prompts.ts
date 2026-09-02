import prompts from 'prompts'
import type { SqlDump, Database } from '@sql-extractor/core'
import type { ExtractOptions } from './extract.js'

export async function resolveDatabase(
  dump: SqlDump,
  databaseName?: string,
): Promise<string> {
  if (databaseName) {
    const db = dump.databases.find((d) => d.name === databaseName)
    if (!db) {
      const names = dump.databases.map((d) => d.name).join(', ')
      throw new Error(
        `Error: Database not found: ${databaseName}\nAvailable databases: ${names}`,
      )
    }
    return databaseName
  }

  const response = await prompts({
    type: 'select',
    name: 'database',
    message: 'Select a database',
    choices: dump.databases.map((db) => ({
      title: db.name,
      value: db.name,
    })),
  })

  if (!response.database) {
    console.log('No database selected. Exiting.')
    process.exit(1)
  }

  return response.database
}

export async function resolveTables(
  dump: SqlDump,
  databaseName: string,
  options: ExtractOptions,
): Promise<string[] | 'all'> {
  const db: Database | undefined = dump.databases.find(
    (d) => d.name === databaseName,
  )

  if (!db) {
    throw new Error(`Error: Database not found: ${databaseName}`)
  }

  const tableNames: string[] = db.tables.map((t) => t.name)

  // Non-interactive: --all
  if (options.all) {
    return 'all'
  }

  // Non-interactive: --tables
  if (options.tables) {
    const requested: string[] = options.tables
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    const missing: string[] = requested.filter(
      (name) => !tableNames.includes(name),
    )
    if (missing.length > 0) {
      throw new Error(
        `Error: Table not found: ${missing.join(', ')}\nAvailable tables in "${databaseName}": ${tableNames.join(', ')}`,
      )
    }

    return requested
  }

  // Interactive: prompt for all or specific
  const allResponse = await prompts({
    type: 'toggle',
    name: 'all',
    message: 'Extract all tables?',
    initial: true,
    active: 'Yes',
    inactive: 'No',
  })

  if (allResponse.all === undefined) {
    console.log('No selection made. Exiting.')
    process.exit(1)
  }

  if (allResponse.all) {
    return 'all'
  }

  // Interactive: multiselect tables
  const tableResponse = await prompts({
    type: 'multiselect',
    name: 'tables',
    message: 'Select tables to extract',
    choices: tableNames.map((name) => ({
      title: name,
      value: name,
    })),
    instructions: false,
  })

  if (!tableResponse.tables || tableResponse.tables.length === 0) {
    console.log('No tables selected. Exiting.')
    process.exit(1)
  }

  return tableResponse.tables
}

export async function resolveOutputPath(
  outputPath?: string,
): Promise<string> {
  if (outputPath) {
    return outputPath
  }

  const response = await prompts({
    type: 'text',
    name: 'path',
    message: 'Output file path',
    initial: 'output.sql',
  })

  if (!response.path) {
    throw new Error('Error: Output file path is required.')
  }

  return response.path
}
