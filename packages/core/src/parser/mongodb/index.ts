import type { SqlDump, Database, Table } from '../../types/index.js'
import type { FormatParser, DataBlock } from '../shared/format-parser.js'
import { ANSI_DIALECT } from '../shared/dialect.js'
import { readBalanced } from '../shared/syntax.js'
import {
  readColumns as readColumnsShared,
  readInsertBlock,
  countInsertRows,
} from '../shared/script-parser.js'

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

/** A JS value rendered as the SQL literal the generated INSERT will carry. */
function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  // An object or array has no column of its own; keep its JSON as the value.
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return "'" + text.replace(/'/g, "''") + "'"
}

function quoteIdentifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

/**
 * Every document in one insert call.
 *
 * `JSON.parse` is the whole parser: a script written by hand with unquoted
 * keys or `ObjectId(...)` calls is JavaScript, not JSON, and is skipped rather
 * than half-read. Export tools write Extended JSON, which parses.
 */
function readDocuments(argument: string): Record<string, unknown>[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(argument.trim())
  } catch {
    return []
  }

  const list = Array.isArray(parsed) ? parsed : [parsed]
  return list.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  )
}

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

    const documents = readDocuments(argument)
    if (documents.length === 0) continue

    const existing = collections.get(collection)
    if (existing) existing.push(...documents)
    else collections.set(collection, documents)
  }

  const tables: Table[] = []
  for (const [name, documents] of collections) {
    // Union of keys, first-seen order: a later document may carry fields the
    // first one never had, and dropping them would lose data silently.
    const columns: string[] = []
    for (const document of documents) {
      for (const key of Object.keys(document)) {
        if (!columns.includes(key)) columns.push(key)
      }
    }

    // Every column is declared text. A collection has no schema to read a
    // type from, and text is the one type that loses nothing: numbers still
    // insert, and a nested value is already carried as its JSON text.
    const createStatement =
      'CREATE TABLE ' +
      quoteIdentifier(name) +
      ' (\n' +
      columns.map((c) => '  ' + quoteIdentifier(c) + ' text').join(',\n') +
      '\n);'

    // Own properties only. A document may carry a field named after something
    // on Object.prototype — toString, constructor — and a plain lookup on a
    // document that lacks it would return the inherited function as the value.
    const values = documents
      .map(
        (document) =>
          '  (' +
          columns
            .map((c) =>
              toSqlLiteral(Object.hasOwn(document, c) ? document[c] : null),
            )
            .join(', ') +
          ')',
      )
      .join(',\n')

    const insert =
      'INSERT INTO ' +
      quoteIdentifier(name) +
      ' (' +
      columns.map(quoteIdentifier).join(', ') +
      ') VALUES\n' +
      values +
      ';'

    tables.push({
      name,
      database: databaseName,
      format: 'mongodb',
      createStatement,
      preDataStatements: [],
      dataStatements: documents.length > 0 ? [insert] : [],
      postDataStatements: [],
    })
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
