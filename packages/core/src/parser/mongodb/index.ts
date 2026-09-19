import type { SqlDump, Database, Table } from '../../types/index.js'
import type { FormatParser, DataBlock } from '../shared/format-parser.js'
import { ANSI_DIALECT } from '../shared/dialect.js'
import { readBalanced } from '../shared/syntax.js'
import {
  readColumns as readColumnsShared,
  readInsertBlock,
  countInsertRows,
} from '../shared/script-parser.js'
import { readJsonObjects, tableFromDocuments } from '../shared/documents.js'

const INSERT_CALL =
  /\bdb\s*\.\s*(?:getCollection\s*\(\s*["']([^"']+)["']\s*\)|([A-Za-z_][\w$]*))\s*\.\s*(insertMany|insertOne|save)\s*\(/g

const USE_DB = /^\s*use\s+([A-Za-z_][\w$-]*)\s*;?\s*$/im

const DEFAULT_DATABASE = 'default'

export function parseMongoDump(text: string): SqlDump {
  const databaseName = USE_DB.exec(text)?.[1] ?? DEFAULT_DATABASE

  const collections = new Map<string, Record<string, unknown>[]>()

  INSERT_CALL.lastIndex = 0
  let call: RegExpExecArray | null
  while ((call = INSERT_CALL.exec(text)) !== null) {
    const collection = (call[1] ?? call[2]) as string
    const open = INSERT_CALL.lastIndex - 1
    const argument = readBalanced(text, open, ANSI_DIALECT.syntax)

    const documents = readJsonObjects(argument)
    if (documents.length === 0) continue

    const existing = collections.get(collection)
    if (existing) existing.push(...documents)
    else collections.set(collection, documents)
  }

  const tables: Table[] = []
  for (const [name, documents] of collections) {
    tables.push(tableFromDocuments(name, databaseName, 'mongodb', documents))
  }

  const database: Database = {
    name: databaseName,
    createStatement: '',
    useStatement: '',
    tables,
  }

  return {
    format: 'mongodb',
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

export const mongodbParser: FormatParser = {
  format: 'mongodb',
  parse: parseMongoDump,
  readColumns,
  readDataBlock,
  countDataRows,
}
