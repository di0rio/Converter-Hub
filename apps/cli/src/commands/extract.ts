import { parseDump, extractDatabase } from '@sql-extractor/core'
import type { ExtractionOptions, SqlDump } from '@sql-extractor/core'
import { readSqlFile, writeOutputFile } from '../utils/io.js'
import { resolveDatabase, resolveTables, resolveOutputPath } from './prompts.js'

export interface ExtractOptions {
  database?: string
  all?: boolean
  tables?: string
  output?: string
}

export async function extractCommand(
  filePath: string,
  options: ExtractOptions,
): Promise<void> {
  // 1. Read the SQL file
  const sql = await readSqlFile(filePath)

  // 2. Parse the SQL dump
  const dump: SqlDump = parseDump(sql)

  // 3. Validate databases exist
  if (dump.databases.length === 0) {
    throw new Error('Error: No databases found in SQL dump.')
  }

  // 4. Resolve database
  const database = await resolveDatabase(dump, options.database)

  // 5. Resolve tables
  const tables = await resolveTables(dump, database, options)

  // 6. Resolve output path
  const outputPath = await resolveOutputPath(options.output)

  // 7. Extract
  const extractionOptions: ExtractionOptions = { database, tables }
  const result = extractDatabase(dump, extractionOptions)

  // 8. Write output
  await writeOutputFile(outputPath, result.sql)

  // 9. Summary
  console.log(
    `Extracted ${result.tableCount} table(s) from database "${result.database}" to ${outputPath}`,
  )
}
