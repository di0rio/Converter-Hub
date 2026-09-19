import type { SqlDump, Database, Table } from '../../types/index.js'
import type { FormatParser, DataBlock } from '../shared/format-parser.js'
import { ORACLE_DIALECT, splitScript } from '../shared/dialect.js'
import { stripLeadingComments } from '../shared/syntax.js'
import {
  readColumns as readColumnsShared,
  readInsertBlock,
  countInsertRows,
} from '../shared/script-parser.js'
import { qualifiedNameAfter } from '../shared/standard-names.js'

const DEFAULT_SCHEMA = 'default'

type StatementType =
  | 'comment'
  | 'current_schema'
  | 'create_user'
  | 'create_table'
  | 'insert'
  | 'alter_table'
  | 'create_index'
  | 'sequence'
  | 'plsql'
  | 'set'
  | 'unknown'

const SCRIPT_DIRECTIVE = /^(REM|PROMPT)(\s|$)/i

function statementHead(sql: string): string {
  let rest = stripLeadingComments(sql)

  while (SCRIPT_DIRECTIVE.test(rest)) {
    const newline = rest.indexOf('\n')
    if (newline === -1) return ''
    rest = stripLeadingComments(rest.slice(newline + 1))
  }

  return rest
}

function classifyStatement(sql: string): StatementType {
  const clean = statementHead(sql)
  if (clean.length === 0) return 'comment'

  if (/^ALTER\s+SESSION\s+SET\s+CURRENT_SCHEMA\b/i.test(clean))
    return 'current_schema'
  if (/^(CREATE|ALTER)\s+USER\b/i.test(clean)) return 'create_user'
  if (/^CREATE\s+(?:GLOBAL\s+TEMPORARY\s+)?TABLE\b/i.test(clean))
    return 'create_table'
  if (/^INSERT\s+INTO\b/i.test(clean)) return 'insert'
  if (/^ALTER\s+TABLE\b/i.test(clean)) return 'alter_table'
  if (/^CREATE\s+(?:UNIQUE\s+|BITMAP\s+)?INDEX\b/i.test(clean))
    return 'create_index'
  if (/^(CREATE|ALTER|DROP)\s+SEQUENCE\b/i.test(clean)) return 'sequence'
  if (
    /^CREATE\s+(OR\s+REPLACE\s+)?(TRIGGER|PROCEDURE|FUNCTION|PACKAGE|TYPE)\b/i.test(
      clean,
    )
  ) {
    return 'plsql'
  }
  if (/^(SET|ALTER\s+SESSION)\b/i.test(clean)) return 'set'

  return 'unknown'
}

export function parseOracleDump(sql: string): SqlDump {
  const statements = splitScript(sql, ORACLE_DIALECT)

  const schemas = new Map<string, Database>()
  const tables = new Map<string, Table>()

  let preamble = ''
  let postamble = ''
  let preambleComplete = false
  let currentSchema: string | null = null

  function schemaKey(schema: string, table: string): string {
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
      format: 'oracle',
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

  function existingTableNamedBy(
    statement: string,
    prefix: string,
  ): Table | null {
    const qualified = qualifiedNameAfter(statement, prefix)
    if (!qualified) return null
    const schema = qualified.schema ?? currentSchema ?? DEFAULT_SCHEMA
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

  function tableAfterOn(statement: string): Table | null {
    return existingTableNamedBy(statement, String.raw`\bON\s+`)
  }

  for (const stmt of statements) {
    const type = classifyStatement(stmt)

    switch (type) {
      case 'current_schema': {
        const match = stmt.match(
          /CURRENT_SCHEMA\s*=\s*("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$#]*)/i,
        )
        if (match) {
          const name = (match[1] as string).replace(/^"|"$/g, '')
          currentSchema = name
          const schema = schemas.get(name)
          if (schema && schema.useStatement === '') schema.useStatement = stmt
          else park(stmt)
        } else {
          park(stmt)
        }
        break
      }

      case 'create_user': {
        const name = qualifiedNameAfter(
          stmt,
          String.raw`(?:CREATE|ALTER)\s+USER\s+`,
        )
        if (name && currentSchema === null) currentSchema = name.name
        park(stmt)
        break
      }

      case 'create_table': {
        const qualified = qualifiedNameAfter(
          stmt,
          String.raw`CREATE\s+(?:GLOBAL\s+TEMPORARY\s+)?TABLE\s+`,
        )
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

      case 'create_index':
      case 'plsql': {
        const table = tableAfterOn(stmt)
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
    format: 'oracle',
    databases: [...schemas.values()],
    preamble: preamble.trimEnd(),
    postamble: postamble.trimEnd(),
  }
}

export function readColumns(createStatement: string): string[] {
  return readColumnsShared(createStatement, ORACLE_DIALECT)
}

export function readDataBlock(statement: string): DataBlock {
  return readInsertBlock(statement, ORACLE_DIALECT)
}

export function countDataRows(statement: string): number {
  return countInsertRows(statement, ORACLE_DIALECT)
}

export const oracleParser: FormatParser = {
  format: 'oracle',
  parse: parseOracleDump,
  readColumns,
  readDataBlock,
  countDataRows,
}
