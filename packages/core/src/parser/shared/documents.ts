import type { Table } from '../../types/index.js'
import type { DatabaseFormat } from '../../formats/index.js'

export function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return "'" + text.replace(/'/g, "''") + "'"
}

export function quoteIdentifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

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
