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

/**
 * The schema an unqualified Oracle table belongs to.
 *
 * Oracle resolves an unqualified name against the connected user's schema,
 * which a script file does not record. `ALTER SESSION SET CURRENT_SCHEMA` and
 * `CONNECT` name it when present; this is the last resort, and is deliberately
 * a plain word rather than an invented company-sounding name.
 */
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

/** REM and PROMPT comment out the rest of their line, like `--` does. */
const SCRIPT_DIRECTIVE = /^(REM|PROMPT)(\s|$)/i

/**
 * Statement text with every leading comment removed, `REM` and `PROMPT` lines
 * included.
 *
 * Those lines travel attached to the statement that follows them, so treating
 * one as the whole statement would silently drop the table it introduces —
 * which is exactly what an Oracle script does before every CREATE TABLE.
 */
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

  if (/^ALTER\s+SESSION\s+SET\s+CURRENT_SCHEMA\b/i.test(clean)) return 'current_schema'
  if (/^(CREATE|ALTER)\s+USER\b/i.test(clean)) return 'create_user'
  if (/^CREATE\s+(?:GLOBAL\s+TEMPORARY\s+)?TABLE\b/i.test(clean)) return 'create_table'
  if (/^INSERT\s+INTO\b/i.test(clean)) return 'insert'
  if (/^ALTER\s+TABLE\b/i.test(clean)) return 'alter_table'
  if (/^CREATE\s+(?:UNIQUE\s+|BITMAP\s+)?INDEX\b/i.test(clean)) return 'create_index'
  if (/^(CREATE|ALTER|DROP)\s+SEQUENCE\b/i.test(clean)) return 'sequence'
  // A PL/SQL body is preserved as text; this project never implements PL/SQL.
  if (/^CREATE\s+(OR\s+REPLACE\s+)?(TRIGGER|PROCEDURE|FUNCTION|PACKAGE|TYPE)\b/i.test(clean)) {
    return 'plsql'
  }
  if (/^(SET|ALTER\s+SESSION)\b/i.test(clean)) return 'set'

  return 'unknown'
}

/**
 * Parse an Oracle SQL script into a normalised SqlDump.
 *
 * Oracle groups tables by schema — a schema is a user — so each `Database`
 * here is a schema. A lone `/` closing a PL/SQL block is handled by
 * `splitScript` before any of this runs, as are `REM` and `PROMPT` lines.
 *
 * Only what is needed to reach tables, columns and rows is interpreted.
 * Triggers, procedures, packages and types are carried as text and never
 * appear as selectable tables. Statement text is stored verbatim so a SQL
 * export stays valid Oracle SQL. Nothing here is executed.
 */
export function parseOracleDump(sql: string): SqlDump {
  const statements = splitScript(sql, ORACLE_DIALECT)

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

  /**
   * The table a statement names, only if the script already declared it.
   * Trailing DDL for a table that was never created belongs to the dump, not
   * to a table entry invented for it.
   */
  function existingTableNamedBy(statement: string, prefix: string): Table | null {
    const qualified = qualifiedNameAfter(statement, prefix)
    if (!qualified) return null
    const schema = qualified.schema ?? currentSchema ?? DEFAULT_SCHEMA
    return tables.get(schemaKey(schema, qualified.name)) ?? null
  }

  /**
   * Park a statement that belongs to a table but is neither its DDL nor its
   * rows. Whether it has to run before or after the rows is decided by where
   * the script put it, which is the only ordering a script carries.
   */
  function attach(table: Table, statement: string): void {
    if (table.dataStatements.length > 0) table.postDataStatements.push(statement)
    else table.preDataStatements.push(statement)
  }

  function park(statement: string): void {
    if (preambleComplete) postamble += statement + '\n'
    else preamble += statement + '\n'
  }

  /** The table a `CREATE INDEX ... ON t` or trigger `ON t` clause names. */
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
          // Naming a schema also selects it, the way USE does in MySQL.
          const schema = schemas.get(name)
          if (schema && schema.useStatement === '') schema.useStatement = stmt
          else park(stmt)
        } else {
          park(stmt)
        }
        break
      }

      case 'create_user': {
        // A user is a schema in Oracle. Record the name without creating an
        // entry: a schema with no tables is nothing a user can select.
        const name = qualifiedNameAfter(stmt, String.raw`(?:CREATE|ALTER)\s+USER\s+`)
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
        // Both name the table they act on with ON; a PL/SQL body that names no
        // table belongs to the script rather than to any one table.
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
