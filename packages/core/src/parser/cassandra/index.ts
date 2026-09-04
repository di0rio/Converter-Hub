import type { SqlDump, Database, Table } from '../../types/index.js'
import type { FormatParser, DataBlock } from '../shared/format-parser.js'
import { CQL_DIALECT, splitScript } from '../shared/dialect.js'
import { stripLeadingComments } from '../shared/syntax.js'
import {
  readColumns as readColumnsShared,
  readInsertBlock,
  countInsertRows,
} from '../shared/script-parser.js'
import { qualifiedNameAfter } from '../shared/standard-names.js'

/**
 * The keyspace an unqualified table belongs to when the script never says.
 *
 * `USE` names it in practice; this is only the fallback, and is deliberately a
 * plain word rather than an invented name.
 */
const DEFAULT_KEYSPACE = 'default'

type StatementType =
  | 'comment'
  | 'create_keyspace'
  | 'use'
  | 'create_table'
  | 'insert'
  | 'create_index'
  | 'create_type'
  | 'unknown'

function classifyStatement(sql: string): StatementType {
  const clean = stripLeadingComments(sql)
  if (clean.length === 0) return 'comment'
  // CQL also accepts // for a line comment.
  if (clean.startsWith('//')) return 'comment'

  if (/^CREATE\s+KEYSPACE\b/i.test(clean)) return 'create_keyspace'
  if (/^USE\b/i.test(clean)) return 'use'
  if (/^CREATE\s+(?:COLUMNFAMILY|TABLE)\b/i.test(clean)) return 'create_table'
  if (/^INSERT\s+INTO\b/i.test(clean)) return 'insert'
  if (/^CREATE\s+(?:CUSTOM\s+)?INDEX\b/i.test(clean)) return 'create_index'
  if (/^CREATE\s+TYPE\b/i.test(clean)) return 'create_type'

  return 'unknown'
}

/**
 * Parse a CQL script into a normalised SqlDump.
 *
 * Cassandra is not a SQL database, but CQL scripts are: a keyspace holds
 * tables, tables declare typed columns, and rows arrive as INSERT statements.
 * That is the whole shape this project's model needs, so a CQL script fits it
 * without stretching anything.
 *
 * What does not fit is left alone rather than approximated. Collection types
 * (`map<text, int>`) are read as one column, not flattened; user-defined types
 * are carried as text. Statement text is stored verbatim so a SQL export stays
 * valid CQL — this is not a converter. Nothing here is executed.
 */
export function parseCassandraDump(sql: string): SqlDump {
  const statements = splitScript(sql, CQL_DIALECT)

  const keyspaces = new Map<string, Database>()
  const tables = new Map<string, Table>()

  let preamble = ''
  let postamble = ''
  let preambleComplete = false
  let currentKeyspace: string | null = null

  function tableKey(keyspace: string, table: string): string {
    // NUL cannot occur in an identifier, so it is the one separator that
    // cannot make ("a b", "c") and ("a", "b c") collide.
    return keyspace + '\0' + table
  }

  function ensureKeyspace(name: string): Database {
    const existing = keyspaces.get(name)
    if (existing) return existing

    const created: Database = {
      name,
      createStatement: '',
      useStatement: '',
      tables: [],
    }
    keyspaces.set(name, created)
    preambleComplete = true
    return created
  }

  function ensureTable(keyspace: string, name: string): Table {
    const key = tableKey(keyspace, name)
    const existing = tables.get(key)
    if (existing) return existing

    const database = ensureKeyspace(keyspace)
    const created: Table = {
      name,
      database: keyspace,
      format: 'cassandra',
      createStatement: '',
      preDataStatements: [],
      dataStatements: [],
      postDataStatements: [],
    }
    database.tables.push(created)
    tables.set(key, created)
    return created
  }

  function existingTableNamedBy(statement: string, prefix: string): Table | null {
    const qualified = qualifiedNameAfter(statement, prefix)
    if (!qualified) return null
    const keyspace = qualified.schema ?? currentKeyspace ?? DEFAULT_KEYSPACE
    return tables.get(tableKey(keyspace, qualified.name)) ?? null
  }

  function attach(table: Table, statement: string): void {
    if (table.dataStatements.length > 0) table.postDataStatements.push(statement)
    else table.preDataStatements.push(statement)
  }

  function park(statement: string): void {
    if (preambleComplete) postamble += statement + '\n'
    else preamble += statement + '\n'
  }

  for (const stmt of statements) {
    const type = classifyStatement(stmt)

    switch (type) {
      case 'create_keyspace': {
        const name = qualifiedNameAfter(
          stmt,
          String.raw`CREATE\s+KEYSPACE\s+(?:IF\s+NOT\s+EXISTS\s+)?`,
        )
        if (name) ensureKeyspace(name.name).createStatement = stmt
        else park(stmt)
        break
      }

      case 'use': {
        const name = qualifiedNameAfter(stmt, String.raw`USE\s+`)
        if (name) {
          currentKeyspace = name.name
          const keyspace = ensureKeyspace(name.name)
          if (keyspace.useStatement === '') keyspace.useStatement = stmt
        } else {
          park(stmt)
        }
        break
      }

      case 'create_table': {
        const qualified = qualifiedNameAfter(
          stmt,
          String.raw`CREATE\s+(?:COLUMNFAMILY|TABLE)\s+(?:IF\s+NOT\s+EXISTS\s+)?`,
        )
        if (qualified) {
          const table = ensureTable(
            qualified.schema ?? currentKeyspace ?? DEFAULT_KEYSPACE,
            qualified.name,
          )
          table.createStatement = stmt
        }
        break
      }

      case 'insert': {
        const qualified = qualifiedNameAfter(stmt, String.raw`INSERT\s+INTO\s+`)
        if (qualified) {
          ensureTable(
            qualified.schema ?? currentKeyspace ?? DEFAULT_KEYSPACE,
            qualified.name,
          ).dataStatements.push(stmt)
        } else {
          park(stmt)
        }
        break
      }

      case 'create_index': {
        const table = existingTableNamedBy(stmt, String.raw`\bON\s+`)
        if (table) attach(table, stmt)
        else park(stmt)
        break
      }

      case 'create_type':
      case 'comment':
      case 'unknown': {
        park(stmt)
        break
      }
    }
  }

  return {
    format: 'cassandra',
    databases: [...keyspaces.values()],
    preamble: preamble.trimEnd(),
    postamble: postamble.trimEnd(),
  }
}

export function readColumns(createStatement: string): string[] {
  return readColumnsShared(createStatement, CQL_DIALECT)
}

export function readDataBlock(statement: string): DataBlock {
  return readInsertBlock(statement, CQL_DIALECT)
}

export function countDataRows(statement: string): number {
  return countInsertRows(statement, CQL_DIALECT)
}

export const cassandraParser: FormatParser = {
  format: 'cassandra',
  parse: parseCassandraDump,
  readColumns,
  readDataBlock,
  countDataRows,
}
