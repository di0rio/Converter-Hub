import type { SqlDump, Database, Table } from '../../types/index.js'
import type { FormatParser, DataBlock } from '../shared/format-parser.js'
import { DB2_DIALECT, splitScript } from '../shared/dialect.js'
import { stripLeadingComments } from '../shared/syntax.js'
import {
  readColumns as readColumnsShared,
  readInsertBlock,
  countInsertRows,
} from '../shared/script-parser.js'
import { qualifiedNameAfter } from '../shared/standard-names.js'

/**
 * The schema an unqualified Db2 table belongs to.
 *
 * Db2 resolves against CURRENT SCHEMA, which defaults to the connecting
 * authorisation id and is not recorded in a script. `SET SCHEMA` names it when
 * present; this is the last resort.
 */
const DEFAULT_SCHEMA = 'default'

type StatementType =
  | 'comment'
  | 'set_schema'
  | 'create_schema'
  | 'create_table'
  | 'insert'
  | 'alter_table'
  | 'create_index'
  | 'sequence'
  | 'set'
  | 'unknown'

function classifyStatement(sql: string): StatementType {
  const clean = stripLeadingComments(sql)
  if (clean.length === 0) return 'comment'

  if (/^SET\s+(CURRENT\s+)?SCHEMA\b/i.test(clean)) return 'set_schema'
  if (/^CREATE\s+SCHEMA\b/i.test(clean)) return 'create_schema'
  if (/^CREATE\s+TABLE\b/i.test(clean)) return 'create_table'
  if (/^INSERT\s+INTO\b/i.test(clean)) return 'insert'
  if (/^ALTER\s+TABLE\b/i.test(clean)) return 'alter_table'
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(clean)) return 'create_index'
  if (/^(CREATE|ALTER|DROP)\s+SEQUENCE\b/i.test(clean)) return 'sequence'
  if (/^SET\b/i.test(clean)) return 'set'

  return 'unknown'
}

/**
 * Parse an IBM Db2 SQL script into a normalised SqlDump.
 *
 * Db2 groups tables by schema, so each `Database` here is a schema. Only what
 * is needed to reach tables, columns and rows is interpreted; routines and
 * anything else are carried as text. Statement text is stored verbatim so a
 * SQL export stays valid Db2 SQL. Nothing here is executed.
 */
export function parseDb2Dump(sql: string): SqlDump {
  const statements = splitScript(sql, DB2_DIALECT)

  const schemas = new Map<string, Database>()
  const tables = new Map<string, Table>()

  let preamble = ''
  let postamble = ''
  let preambleComplete = false
  let currentSchema: string | null = null

  function schemaKey(schema: string, table: string): string {
    // NUL cannot occur in an identifier, so it is the one separator that
    // cannot make ("a b", "c") and ("a", "b c") collide.
    return schema + '\0' + table
  }

  function ensureSchema(name: string): Database {
    const existing = schemas.get(name)
    if (existing) return existing

    const created: Database = {
      name,
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
      format: 'db2',
      createStatement: '',
      preDataStatements: [],
      dataStatements: [],
      postDataStatements: [],
    }
    database.tables.push(created)
    tables.set(key, created)
    return created
  }

  function tableNamedBy(statement: string, prefix: string): Table | null {
    const qualified = qualifiedNameAfter(statement, prefix)
    if (!qualified) return null
    return ensureTable(
      qualified.schema ?? currentSchema ?? DEFAULT_SCHEMA,
      qualified.name,
    )
  }

  function existingTableNamedBy(statement: string, prefix: string): Table | null {
    const qualified = qualifiedNameAfter(statement, prefix)
    if (!qualified) return null
    const schema = qualified.schema ?? currentSchema ?? DEFAULT_SCHEMA
    return tables.get(schemaKey(schema, qualified.name)) ?? null
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
      case 'set_schema': {
        const name = qualifiedNameAfter(
          stmt,
          String.raw`SET\s+(?:CURRENT\s+)?SCHEMA\s+`,
        )
        if (name) {
          currentSchema = name.name
          const schema = schemas.get(name.name)
          if (schema && schema.useStatement === '') schema.useStatement = stmt
          else park(stmt)
        } else {
          park(stmt)
        }
        break
      }

      case 'create_schema': {
        const name = qualifiedNameAfter(stmt, String.raw`CREATE\s+SCHEMA\s+`)
        if (name && name.name.toUpperCase() !== 'AUTHORIZATION') {
          ensureSchema(name.name).createStatement = stmt
        } else {
          park(stmt)
        }
        break
      }

      case 'create_table': {
        const qualified = qualifiedNameAfter(stmt, String.raw`CREATE\s+TABLE\s+`)
        if (qualified) {
          const table = ensureTable(
            qualified.schema ?? currentSchema ?? DEFAULT_SCHEMA,
            qualified.name,
          )
          table.createStatement = stmt
        }
        break
      }

      case 'insert': {
        const table = tableNamedBy(stmt, String.raw`INSERT\s+INTO\s+`)
        if (table) table.dataStatements.push(stmt)
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

      case 'sequence':
      case 'set':
      case 'comment':
      case 'unknown': {
        park(stmt)
        break
      }
    }
  }

  return {
    format: 'db2',
    databases: [...schemas.values()],
    preamble: preamble.trimEnd(),
    postamble: postamble.trimEnd(),
  }
}

export function readColumns(createStatement: string): string[] {
  return readColumnsShared(createStatement, DB2_DIALECT)
}

export function readDataBlock(statement: string): DataBlock {
  return readInsertBlock(statement, DB2_DIALECT)
}

export function countDataRows(statement: string): number {
  return countInsertRows(statement, DB2_DIALECT)
}

export const db2Parser: FormatParser = {
  format: 'db2',
  parse: parseDb2Dump,
  readColumns,
  readDataBlock,
  countDataRows,
}
