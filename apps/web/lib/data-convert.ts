import {
  DataFormatError,
  detectDelimiter,
  parseCsv,
  parseJson,
  parseJsonl,
  recordsToTable,
  tableToRecords,
  toCsv,
  toFileName,
  toJsonl,
  toSqlInserts,
  toXlsx,
  type CsvDelimiter,
} from '@sql-extractor/core'
import { toMarkdown } from '@/lib/sheet-writers'
import { DATA_INPUTS, DATA_OUTPUTS, FILE_FORMATS } from '@/lib/formats'

/**
 * The data tool: one structured file in, one file out.
 *
 * Every input becomes a plain value — a CSV becomes a list of records — and
 * every output is written from that value. JSON, JSON Lines and YAML take any
 * shape; the table outputs go through `recordsToTable`, which refuses a shape
 * that is not a table rather than flattening it.
 */

export { DATA_INPUTS, DATA_OUTPUTS }
export type DataInput = (typeof DATA_INPUTS)[number]
export type DataOutput = (typeof DATA_OUTPUTS)[number]

export type DataFile = { filename: string; bytes: Uint8Array; type: string }

/** YAML is loaded only by a page that meets a YAML file or writes one. */
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

  const table = recordsToTable(name, value)
  switch (format) {
    case 'csv':
      return toCsv(table, { delimiter })
    case 'tsv':
      return toCsv(table, { delimiter: '\t' })
    case 'markdown':
      return toMarkdown(table)
    case 'sql':
      return toSqlInserts(table, { tableName: name })
    case 'xlsx':
      return toXlsx([table])
  }
}

/** Read `text` as `input` and write it as `output`, named after `name`. */
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
  const format = FILE_FORMATS[output]
  return {
    filename: `${toFileName(name, 'data')}${format.extensions[0]}`,
    bytes:
      typeof content === 'string' ? new TextEncoder().encode(content) : content,
    type: format.type,
  }
}
