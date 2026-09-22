import {
  createZip,
  DataFormatError,
  detectDelimiter,
  parseCsv,
  parseJson,
  parseJsonl,
  recordsToTables,
  tableToRecords,
  toCsv,
  toFileName,
  toJsonl,
  toSqlInserts,
  toXlsx,
  uniqueName,
  type CsvDelimiter,
  type TabularTable,
} from '@sql-extractor/core'
import { toMarkdown } from '@/lib/sheet-writers'
import { parseXml } from '@/lib/xml'
import { DATA_INPUTS, DATA_OUTPUTS, FILE_FORMATS } from '@/lib/formats'

export { DATA_INPUTS, DATA_OUTPUTS }
export type DataInput = (typeof DATA_INPUTS)[number]
export type DataOutput = (typeof DATA_OUTPUTS)[number]

export type DataFile = { filename: string; bytes: Uint8Array; type: string }

const loadYaml = () => import('yaml')

function rowsToRecords(rows: string[][]) {
  const [header = [], ...body] = rows
  return tableToRecords({ name: 'data', columns: header, rows: body })
}

export async function readData(
  text: string,
  format: DataInput,
): Promise<unknown> {
  switch (format) {
    case 'csv':
      return rowsToRecords(parseCsv(text, { delimiter: detectDelimiter(text) }))
    case 'tsv':
      return rowsToRecords(parseCsv(text, { delimiter: '\t' }))
    case 'json':
      return parseJson(text)
    case 'jsonl':
      return parseJsonl(text)
    case 'xml':
      return parseXml(text)
    case 'yaml': {
      const { parse } = await loadYaml()
      // The library's default alias limit refuses a document that expands
      // into a huge graph from a few bytes of anchors.
      try {
        return parse(text)
      } catch {
        throw new DataFormatError('This file is not valid YAML.')
      }
    }
  }
}

export async function writeData(
  value: unknown,
  format: DataOutput,
  name: string,
  { delimiter = ',' }: { delimiter?: CsvDelimiter } = {},
): Promise<string | Uint8Array> {
  switch (format) {
    case 'json':
      return `${JSON.stringify(value, null, 2)}\n`
    case 'yaml': {
      const { stringify } = await loadYaml()
      return stringify(value)
    }
    case 'jsonl':
      if (!Array.isArray(value)) {
        throw new DataFormatError(
          'JSON Lines needs a list of values, one per line.',
        )
      }
      return toJsonl(value)
  }

  const tables = recordsToTables(name, value)
  if (format === 'xlsx') return toXlsx(tables)

  const write = (table: TabularTable): string => {
    switch (format) {
      case 'csv':
        return toCsv(table, { delimiter })
      case 'tsv':
        return toCsv(table, { delimiter: '\t' })
      case 'markdown':
        return toMarkdown(table)
      case 'sql':
        return toSqlInserts(table, { tableName: table.name })
    }
  }
  const [only] = tables
  if (tables.length === 1 && only) return write(only)

  // Table names come from the file; cleaned and deduplicated they are safe
  // ZIP entry names.
  const taken = new Set<string>()
  const extension = FILE_FORMATS[format].extensions[0]
  return createZip(
    tables.map((table) => ({
      name: `${uniqueName(toFileName(table.name, 'table'), taken)}${extension}`,
      content: new TextEncoder().encode(write(table)),
    })),
  )
}

export async function convertData(
  text: string,
  input: DataInput,
  output: DataOutput,
  name: string,
  options: { delimiter?: CsvDelimiter } = {},
): Promise<DataFile> {
  const content = await writeData(
    await readData(text, input),
    output,
    name,
    options,
  )
  // Bytes from anything but XLSX can only be the ZIP of several tables.
  const zipped = typeof content !== 'string' && output !== 'xlsx'
  const format = FILE_FORMATS[output]
  return {
    filename: `${toFileName(name, 'data')}${zipped ? '.zip' : format.extensions[0]}`,
    bytes:
      typeof content === 'string' ? new TextEncoder().encode(content) : content,
    type: zipped ? 'application/zip' : format.type,
  }
}
