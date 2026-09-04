import {
  parseDump,
  extractDatabase,
  describeFormat,
  isDatabaseFormat,
  isReadable,
  SUPPORTED_FORMATS,
  UnsupportedFormatError,
} from '@sql-extractor/core'
import type {
  DatabaseFormat,
  ExtractionOptions,
  SqlDump,
} from '@sql-extractor/core'
import { readSqlFile, writeOutputFile } from '../utils/io.js'
import { resolveDatabase, resolveTables, resolveOutputPath } from './prompts.js'
import { browseForFile } from './browse.js'

export interface ExtractOptions {
  database?: string
  all?: boolean
  tables?: string
  output?: string
  format?: string
}

const FORMAT_LIST = SUPPORTED_FORMATS.map((f) => f.id).join(', ')

/**
 * Validate an explicit --format, so a typo fails before the file is read.
 *
 * A name the catalog does not hold at all and one it holds but cannot read are
 * different mistakes, and saying which is which saves the guesswork: a typo
 * needs correcting, an unsupported engine needs a different tool.
 */
function resolveFormat(format?: string): DatabaseFormat | undefined {
  if (format === undefined) return undefined

  const normalised = format.trim().toLowerCase()
  if (!isDatabaseFormat(normalised)) {
    throw new Error(
      `Error: Unknown source format: ${format}\nSupported formats: ${FORMAT_LIST}`,
    )
  }

  if (!isReadable(normalised)) {
    const descriptor = describeFormat(normalised)
    // "Not yet" is a promise. Only make it for a format that could still
    // arrive: a product with no local SQL dump never will, and its catalog
    // note says why.
    const reason =
      descriptor.status === 'not_applicable'
        ? `${descriptor.label} has no local SQL dump this tool can read.` +
          (descriptor.note ? `\n${descriptor.note}` : '')
        : `${descriptor.label} dumps are not supported yet.`

    throw new Error(`Error: ${reason}\nSupported formats: ${FORMAT_LIST}`)
  }

  return normalised
}

export async function extractCommand(
  filePath: string | undefined,
  options: ExtractOptions,
): Promise<void> {
  // 1. Resolve an explicit source format, if one was given
  const format = resolveFormat(options.format)

  // 2. Resolve the dump file path, browsing the filesystem if none was given
  const resolvedPath = filePath ?? (await browseForFile())

  // 3. Read the SQL file
  const sql = await readSqlFile(resolvedPath)

  // 4. Parse the dump, detecting the source engine unless told which it is
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

  // 5. Validate that the dump holds something to extract
  if (dump.databases.length === 0) {
    throw new Error(`Error: No ${grouping}s found in ${descriptor.label} dump.`)
  }

  // 6. Resolve database (schema, for formats that group tables that way)
  const database = await resolveDatabase(dump, options.database)

  // 7. Resolve tables
  const tables = await resolveTables(dump, database, options)

  // 8. Resolve output path
  const outputPath = await resolveOutputPath(options.output)

  // 9. Extract
  const extractionOptions: ExtractionOptions = { database, tables }
  const result = extractDatabase(dump, extractionOptions)

  // 10. Write output
  await writeOutputFile(outputPath, result.sql)

  // 11. Summary
  console.log(
    `Extracted ${result.tableCount} table(s) from ${grouping} "${result.database}" to ${outputPath}`,
  )
}
