import type { Table } from '../../types/index.js'
import type { DatabaseFormat } from '../../formats/index.js'

/**
 * Turning schemaless records into the tabular model the rest of the project
 * works on.
 *
 * A document store has no DDL to read and no SQL statements to preserve, so
 * this writes both: a `CREATE TABLE` naming the columns the records actually
 * used, and one `INSERT` carrying their values. Everything above the parser —
 * the column reader, the row reader, the extractor, the generators — then
 * works unchanged, which is why supporting a document source needs no
 * capability flag and no special case in the export path.
 *
 * Shared by MongoDB, Elasticsearch and Neo4j, which differ only in how they
 * find the records and what they call the group.
 */

/** A JS value rendered as the SQL literal the generated INSERT will carry. */
export function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  // An object or array has no column of its own; keep its JSON as the value.
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return "'" + text.replace(/'/g, "''") + "'"
}

export function quoteIdentifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

/**
 * Build one table from the records that belong to it.
 *
 * Columns are the union of every key the records use, in first-seen order: a
 * later record routinely carries fields the first never had, and taking the
 * first one's shape would drop them silently. A record missing a key gets null
 * — read as an own property, since a record may legitimately carry a key named
 * after something on `Object.prototype` (`toString`, `constructor`), and a
 * plain lookup on a record without it would return the inherited function.
 *
 * Every column is declared `text`. There is no schema to read a type from, and
 * without a type the generated CREATE TABLE would not restore.
 */
export function tableFromDocuments(
  name: string,
  database: string,
  format: DatabaseFormat,
  documents: Record<string, unknown>[],
): Table {
  const columns: string[] = []
  for (const document of documents) {
    for (const key of Object.keys(document)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }

  const columnList = columns.map(quoteIdentifier).join(', ')

  const createStatement =
    'CREATE TABLE ' +
    quoteIdentifier(name) +
    ' (\n' +
    columns.map((c) => '  ' + quoteIdentifier(c) + ' text').join(',\n') +
    '\n);'

  const dataStatements: string[] = []
  if (documents.length > 0 && columns.length > 0) {
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

    dataStatements.push(
      'INSERT INTO ' +
        quoteIdentifier(name) +
        ' (' +
        columnList +
        ') VALUES\n' +
        values +
        ';',
    )
  }

  return {
    name,
    database,
    format,
    createStatement,
    preDataStatements: [],
    dataStatements,
    postDataStatements: [],
  }
}

/**
 * Parse one JSON value, returning the objects in it.
 *
 * `JSON.parse` is the whole parser. Anything that is not JSON — a hand-written
 * script with unquoted keys, an `ObjectId(...)` call — is skipped rather than
 * half-read, because half-reading it would invent values.
 */
export function readJsonObjects(text: string): Record<string, unknown>[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.trim())
  } catch {
    return []
  }

  const list = Array.isArray(parsed) ? parsed : [parsed]
  return list.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  )
}
