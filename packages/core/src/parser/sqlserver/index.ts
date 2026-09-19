import type { SqlDump, Database, Table } from '../../types/index.js'
import type { DatabaseFormat } from '../../formats/index.js'
import type { FormatParser } from '../shared/format-parser.js'
import type { DataBlock } from '../shared/format-parser.js'
import { SQLSERVER_DIALECT, splitScript } from '../shared/dialect.js'
import { stripLeadingComments } from '../shared/syntax.js'
import {
  readColumns as readColumnsShared,
  readInsertBlock,
  countInsertRows,
} from '../shared/script-parser.js'
import { qualifiedNameAfter } from './lexer.js'

const DEFAULT_SCHEMA = 'dbo'

type StatementType =
  | 'comment'
  | 'use'
  | 'create_schema'
  | 'create_table'
  | 'insert'
  | 'identity_insert'
  | 'alter_table'
  | 'create_index'
  | 'set'
  | 'unknown'

function classifyStatement(sql: string): StatementType {
  const clean = stripLeadingComments(sql)
  if (clean.length === 0) return 'comment'

  if (/^USE\b/i.test(clean)) return 'use'
  if (/^CREATE\s+SCHEMA\b/i.test(clean)) return 'create_schema'
  if (/^CREATE\s+TABLE\b/i.test(clean)) return 'create_table'
  if (/^SET\s+IDENTITY_INSERT\b/i.test(clean)) return 'identity_insert'
  if (/^INSERT\b/i.test(clean)) return 'insert'
  if (/^ALTER\s+TABLE\b/i.test(clean)) return 'alter_table'
  if (
    /^CREATE\s+(?:UNIQUE\s+)?(?:CLUSTERED\s+|NONCLUSTERED\s+)?INDEX\b/i.test(
      clean,
    )
  ) {
    return 'create_index'
  }
  if (/^SET\b/i.test(clean)) return 'set'

  return 'unknown'
}

export function parseSqlServerDump(
  sql: string,
  format: SqlServerFamilyFormat = 'sqlserver',
): SqlDump {
  const statements = splitScript(sql, SQLSERVER_DIALECT)

  const schemas = new Map<string, Database>()
  const tables = new Map<string, Table>()

  let preamble = ''
  let postamble = ''
  let preambleComplete = false

  let catalog: string | undefined

  function schemaKey(schema: string, table: string): string {
    return schema + '\0' + table
  }

  function ensureSchema(name: string): Database {
    const existing = schemas.get(name)
    if (existing) return existing

    const created: Database = {
      name,
      catalog,
      createStatement: '',
      useStatement: '',
      tables: [],
    }
    schemas.set(name, created)
    preambleComplete = true
    return created
  }

  function ensureTable(schema: string, name: string): Table {
    const key = schemaKey(schema, name)
    const existing = tables.get(key)
    if (existing) return existing

    const database = ensureSchema(schema)
    const created: Table = {
      name,
      database: schema,
      format,
      createStatement: '',
      preDataStatements: [],
      dataStatements: [],
      postDataStatements: [],
    }
    database.tables.push(created)
    tables.set(key, created)
    return created
  }

  function tableNamedBy(sql: string, prefix: string): Table | null {
    const qualified = qualifiedNameAfter(sql, prefix)
    if (!qualified) return null
    return ensureTable(qualified.schema ?? DEFAULT_SCHEMA, qualified.name)
  }

  function existingTableNamedBy(sql: string, prefix: string): Table | null {
    const qualified = qualifiedNameAfter(sql, prefix)
    if (!qualified) return null
    const schema = qualified.schema ?? DEFAULT_SCHEMA
    return tables.get(schemaKey(schema, qualified.name)) ?? null
  }

  function attach(table: Table, statement: string): void {
    if (table.dataStatements.length > 0)
      table.postDataStatements.push(statement)
    else table.preDataStatements.push(statement)
  }

  function park(statement: string): void {
    if (preambleComplete) postamble += statement + '\n'
    else preamble += statement + '\n'
  }

  for (const stmt of statements) {
    const type = classifyStatement(stmt)

    switch (type) {
      case 'use': {
        const name = qualifiedNameAfter(stmt, String.raw`USE\s+`)
        if (name) catalog = name.name
        park(stmt)
        break
      }

      case 'create_schema': {
        const name = qualifiedNameAfter(stmt, String.raw`CREATE\s+SCHEMA\s+`)
        if (name && name.name.toUpperCase() !== 'AUTHORIZATION') {
          ensureSchema(name.name).createStatement = stmt
        }
        break
      }

      case 'create_table': {
        const qualified = qualifiedNameAfter(
          stmt,
          String.raw`CREATE\s+TABLE\s+`,
        )
        if (qualified) {
          const table = ensureTable(
            qualified.schema ?? DEFAULT_SCHEMA,
            qualified.name,
          )
          table.createStatement = stmt
        }
        break
      }

      case 'insert': {
        const table = tableNamedBy(stmt, String.raw`INSERT\s+(?:INTO\s+)?`)
        if (table) table.dataStatements.push(stmt)
        else park(stmt)
        break
      }

      case 'identity_insert': {
        const table = existingTableNamedBy(
          stmt,
          String.raw`SET\s+IDENTITY_INSERT\s+`,
        )
        if (table) attach(table, stmt)
        else park(stmt)
        break
      }

      case 'alter_table': {
        const table = existingTableNamedBy(stmt, String.raw`ALTER\s+TABLE\s+`)
        if (table) attach(table, stmt)
        else park(stmt)
        break
      }

      case 'create_index': {
        const table = existingTableNamedBy(stmt, String.raw`\bON\s+`)
        if (table) attach(table, stmt)
        else park(stmt)
        break
      }

      case 'set':
      case 'comment':
      case 'unknown': {
        park(stmt)
        break
      }
    }
  }

  return {
    format,
    databases: [...schemas.values()],
    preamble: preamble.trimEnd(),
    postamble: postamble.trimEnd(),
  }
}

export function readColumns(createStatement: string): string[] {
  return readColumnsShared(createStatement, SQLSERVER_DIALECT)
}

export function readDataBlock(statement: string): DataBlock {
  return readInsertBlock(statement, SQLSERVER_DIALECT)
}

export function countDataRows(statement: string): number {
  return countInsertRows(statement, SQLSERVER_DIALECT)
}

export type SqlServerFamilyFormat = Extract<
  DatabaseFormat,
  'sqlserver' | 'synapse'
>

export function createSqlServerParser(
  format: SqlServerFamilyFormat,
): FormatParser {
  return {
    format,
    parse: (sql) => parseSqlServerDump(sql, format),
    readColumns,
    readDataBlock,
    countDataRows,
  }
}

export const sqlserverParser: FormatParser = createSqlServerParser('sqlserver')
