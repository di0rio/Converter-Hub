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

/**
 * Read a mongosh seed script — `use <db>` plus `db.<collection>.insertMany([…])`.
 *
 * This is the one MongoDB text format that names what it holds. `mongoexport`
 * writes documents and nothing else: no database name, no collection name, so
 * a file of it could only be given invented names, and the whole point of this
 * tool — pick a database, then pick tables out of it — would collapse to one
 * anonymous table. That is why only the script form is read.
 *
 * Documents have no fixed columns, so the column set is the union of the keys
 * every document in a collection uses, in first-seen order. A document missing
 * one of them gets null for it, which is what a spreadsheet needs.
 *
 * Nested objects and arrays are kept as their JSON text rather than flattened
 * into more columns — the same rule already applied to binary literals: carry
 * the value as written instead of inventing a shape for it.
 */

/** `db.<collection>.insertMany(` or `.insertOne(` — the call that carries rows. */
const INSERT_CALL =
  /\bdb\s*\.\s*(?:getCollection\s*\(\s*["']([^"']+)["']\s*\)|([A-Za-z_][\w$]*))\s*\.\s*(insertMany|insertOne|save)\s*\(/g

/** `use <db>` on its own line, as mongosh writes it. */
const USE_DB = /^\s*use\s+([A-Za-z_][\w$-]*)\s*;?\s*$/im

const DEFAULT_DATABASE = 'default'

export function parseMongoDump(text: string): SqlDump {
  const databaseName = USE_DB.exec(text)?.[1] ?? DEFAULT_DATABASE

  // Collection name to the documents it received, in the order they appeared.
  const collections = new Map<string, Record<string, unknown>[]>()

  INSERT_CALL.lastIndex = 0
  let call: RegExpExecArray | null
  while ((call = INSERT_CALL.exec(text)) !== null) {
    const collection = (call[1] ?? call[2]) as string
    // The call's argument list starts at the paren the match ends on.
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
