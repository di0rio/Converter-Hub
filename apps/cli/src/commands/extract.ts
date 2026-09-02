import {
  parseDump,
  extractDatabase,
  describeFormat,
  isDatabaseFormat,
  SUPPORTED_FORMATS,
  UnsupportedFormatError,
} from '@sql-extractor/core'
import type { DatabaseFormat, ExtractionOptions, SqlDump } from '@sql-extractor/core'
import { readSqlFile, writeOutputFile } from '../utils/io.js'
import { resolveDatabase, resolveTables, resolveOutputPath } from './prompts.js'

export interface ExtractOptions {
  database?: string
  all?: boolean
  tables?: string
  output?: string
  format?: string
}

const FORMAT_LIST = SUPPORTED_FORMATS.map((f) => f.id).join(', ')

/** Validate an explicit --format, so a typo fails before the file is read. */
function resolveFormat(format?: string): DatabaseFormat | undefined {
  if (format === undefined) return undefined

  const normalised = format.trim().toLowerCase()
  if (!isDatabaseFormat(normalised)) {
    throw new Error(
      `Error: Unknown source format: ${format}\nSupported formats: ${FORMAT_LIST}`,
    )
  }

  return normalised
}

export async function extractCommand(
  filePath: string,
  options: ExtractOptions,
): Promise<void> {
  // 1. Resolve an explicit source format, if one was given
  const format = resolveFormat(options.format)

  // 2. Read the SQL file
  const sql = await readSqlFile(filePath)

  // 3. Parse the dump, detecting the source engine unless told which it is
  let dump: SqlDump
  try {
    dump = parseDump(sql, { format })
  } catch (err) {
    if (err instanceof UnsupportedFormatError) {
      throw new Error(
        `Error: Unsupported database format.\nSupported formats: ${FORMAT_LIST}\nPass --format to read the file as one of them.`,
      )
    }
    throw err
  }

  const descriptor = describeFormat(dump.format)
  const grouping = descriptor.namespace

  // 4. Validate that the dump holds something to extract
  if (dump.databases.length === 0) {
    throw new Error(`Error: No ${grouping}s found in ${descriptor.label} dump.`)
  }

  // 5. Resolve database (schema, for formats that group tables that way)
  const database = await resolveDatabase(dump, options.database)

  // 6. Resolve tables
  const tables = await resolveTables(dump, database, options)

  // 7. Resolve output path
  const outputPath = await resolveOutputPath(options.output)

  // 8. Extract
  const extractionOptions: ExtractionOptions = { database, tables }
  const result = extractDatabase(dump, extractionOptions)

  // 9. Write output
  await writeOutputFile(outputPath, result.sql)

  // 10. Summary
  console.log(
    `Extracted ${result.tableCount} table(s) from ${grouping} "${result.database}" to ${outputPath}`,
  )
}
