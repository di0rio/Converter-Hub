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
  const format = resolveFormat(options.format)

  const resolvedPath = filePath ?? (await browseForFile())

  const sql = await readSqlFile(resolvedPath)

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

  if (dump.databases.length === 0) {
    throw new Error(`Error: No ${grouping}s found in ${descriptor.label} dump.`)
  }

  const database = await resolveDatabase(dump, options.database)

  const tables = await resolveTables(dump, database, options)

  const outputPath = await resolveOutputPath(options.output)

  const extractionOptions: ExtractionOptions = { database, tables }
  const result = extractDatabase(dump, extractionOptions)

  await writeOutputFile(outputPath, result.sql)

  console.log(
    `Extracted ${result.tableCount} table(s) from ${grouping} "${result.database}" to ${outputPath}`,
  )
}
