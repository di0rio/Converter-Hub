import type { SqlDump, Database, Table } from '../../types/index.js'
import type { FormatParser, DataBlock } from '../shared/format-parser.js'
import { ANSI_DIALECT } from '../shared/dialect.js'
import {
  readColumns as readColumnsShared,
  readInsertBlock,
  countInsertRows,
} from '../shared/script-parser.js'
import { readJsonObjects, tableFromDocuments } from '../shared/documents.js'

const DEFAULT_DATABASE = 'elasticsearch'

function documentOf(line: Record<string, unknown>): Record<string, unknown> {
  const source = line['_source']
  if (typeof source === 'object' && source !== null && !Array.isArray(source)) {
    const document = { ...(source as Record<string, unknown>) }
    const id = line['_id']
    if (id !== undefined && !('_id' in document)) document['_id'] = id
    return document
  }
  return line
}

export function parseElasticsearchDump(text: string): SqlDump {
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
