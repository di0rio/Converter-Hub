import type { SqlDump, Database, Table } from '../../types/index.js'
import type { FormatParser, DataBlock } from '../shared/format-parser.js'
import { ANSI_DIALECT } from '../shared/dialect.js'
import {
  readColumns as readColumnsShared,
  readInsertBlock,
  countInsertRows,
} from '../shared/script-parser.js'
import { readJsonObjects, tableFromDocuments } from '../shared/documents.js'

/**
 * Read an `elasticdump` export — one JSON object per line, each naming the
 * index it came from.
 *
 * That `_index` is what makes this readable at all: an export that only
 * carried documents could be given no honest table name. Each index becomes a
 * table, `_source` supplies the row, and the columns are the union of the keys
 * the documents in that index use.
 */

const DEFAULT_DATABASE = 'elasticsearch'

/** The row a dump line describes: `_source` when present, else the line. */
function documentOf(line: Record<string, unknown>): Record<string, unknown> {
  const source = line['_source']
  if (typeof source === 'object' && source !== null && !Array.isArray(source)) {
    const document = { ...(source as Record<string, unknown>) }
    // The id lives outside _source and is the only key a reader can join on.
    const id = line['_id']
    if (id !== undefined && !('_id' in document)) document['_id'] = id
    return document
  }
  return line
}

export function parseElasticsearchDump(text: string): SqlDump {
  // Index name to the documents it holds, in the order they appeared.
  const indices = new Map<string, Record<string, unknown>[]>()

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue

    for (const entry of readJsonObjects(line)) {
      const index = entry['_index']
      if (typeof index !== 'string' || index.length === 0) continue

      const document = documentOf(entry)
      const existing = indices.get(index)
      if (existing) existing.push(document)
      else indices.set(index, [document])
    }
  }

  const tables: Table[] = []
  for (const [name, documents] of indices) {
    tables.push(
      tableFromDocuments(name, DEFAULT_DATABASE, 'elasticsearch', documents),
    )
  }

  const database: Database = {
    name: DEFAULT_DATABASE,
    createStatement: '',
    useStatement: '',
    tables,
  }

  return {
    format: 'elasticsearch',
    databases: tables.length > 0 ? [database] : [],
    preamble: '',
    postamble: '',
  }
}

export function readColumns(createStatement: string): string[] {
  return readColumnsShared(createStatement, ANSI_DIALECT)
}

export function readDataBlock(statement: string): DataBlock {
  return readInsertBlock(statement, ANSI_DIALECT)
}

export function countDataRows(statement: string): number {
  return countInsertRows(statement, ANSI_DIALECT)
}

export const elasticsearchParser: FormatParser = {
  format: 'elasticsearch',
  parse: parseElasticsearchDump,
  readColumns,
  readDataBlock,
  countDataRows,
}
