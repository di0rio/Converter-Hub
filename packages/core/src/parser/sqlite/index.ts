import type { SqlDump, Database, Table } from '../../types/index.js'
import type { DatabaseFormat } from '../../formats/index.js'
import type { FormatParser, DataBlock } from '../shared/format-parser.js'
import { SQLITE_DIALECT, splitScript } from '../shared/dialect.js'
import {
  countInsertRows,
  readColumns as readColumnsShared,
  readInsertBlock,
} from '../shared/script-parser.js'
import {
  SQLITE_SYNTAX,
  stripLeadingComments,
  unquoteIdentifier,
} from '../shared/syntax.js'

const DOUBLE_QUOTED = '"(?:[^"]|"")+"'
const BACK_QUOTED = '`(?:[^`]|``)+`'
const BRACKETED = '\\[[^\\]]*\\]'
const BARE = '[A-Za-z_][A-Za-z0-9_$]*'
const IDENTIFIER =
  '(?:' + DOUBLE_QUOTED + '|' + BACK_QUOTED + '|' + BRACKETED + '|' + BARE + ')'

function nameAfter(sql: string, prefix: string): string | null {
  const match = new RegExp(prefix + '\\s*(' + IDENTIFIER + ')', 'i').exec(sql)
  if (!match) return null
  return unquoteIdentifier(match[1] as string, SQLITE_SYNTAX)
}

const CREATE_TABLE_PREFIX =
  'CREATE\\s+(?:TEMP(?:ORARY)?\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?'
const INSERT_PREFIX = 'INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+'
const DELETE_PREFIX = 'DELETE\\s+FROM\\s+'
const ON_PREFIX = '\\bON\\s+'

type StatementType =
  | 'comment'
  | 'pragma'
  | 'begin'
  | 'commit'
  | 'rollback'
  | 'create_table'
  | 'create_index'
  | 'create_trigger'
  | 'create_view'
  | 'insert'
  | 'delete'
  | 'drop_table'
  | 'drop_index'
  | 'drop_trigger'
  | 'drop_view'
  | 'analyze'
  | 'unknown'

function classifyStatement(clean: string): StatementType {
  if (clean.length === 0) return 'comment'

  if (/^PRAGMA\b/i.test(clean)) return 'pragma'
  if (/^BEGIN\b/i.test(clean)) return 'begin'
  if (/^COMMIT\b/i.test(clean)) return 'commit'
  if (/^ROLLBACK\b/i.test(clean)) return 'rollback'
  if (/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\b/i.test(clean))
    return 'create_table'
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(clean)) return 'create_index'
  if (/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i.test(clean))
    return 'create_trigger'
  if (/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?VIEW\b/i.test(clean))
    return 'create_view'
  if (/^INSERT\b/i.test(clean)) return 'insert'
  if (/^DELETE\s+FROM\b/i.test(clean)) return 'delete'
  if (/^DROP\s+TABLE\b/i.test(clean)) return 'drop_table'
  if (/^DROP\s+INDEX\b/i.test(clean)) return 'drop_index'
  if (/^DROP\s+TRIGGER\b/i.test(clean)) return 'drop_trigger'
  if (/^DROP\s+VIEW\b/i.test(clean)) return 'drop_view'
  if (/^ANALYZE\b/i.test(clean)) return 'analyze'

  return 'unknown'
}

function isInternalTable(name: string): boolean {
  return /^sqlite_/i.test(name)
}

export function parseSqliteDump(
  sql: string,
  format: SqliteFamilyFormat = 'sqlite',
): SqlDump {
  const statements = splitScript(sql, SQLITE_DIALECT)

  const database: Database = {
    name: 'main',
    createStatement: '',
    useStatement: '',
    tables: [],
  }

  const tables = new Map<string, Table>()

  let preamble = ''
  let postamble = ''
  let preambleComplete = false

  function park(stmt: string): void {
    if (preambleComplete) postamble += stmt + '\n'
    else preamble += stmt + '\n'
  }

  function ensureTable(name: string): Table {
    const existing = tables.get(name)
    if (existing) return existing

    const created: Table = {
      name,
      database: 'main',
      format,
      createStatement: '',
      preDataStatements: [],
      dataStatements: [],
      postDataStatements: [],
    }
    tables.set(name, created)
    database.tables.push(created)
    return created
  }

  for (const stmt of statements) {
    const clean = stripLeadingComments(stmt)
    const type = classifyStatement(clean)

    switch (type) {
      case 'create_table': {
        const name = nameAfter(clean, CREATE_TABLE_PREFIX)
        if (name === null) {
          park(stmt)
          break
        }
        preambleComplete = true
        if (isInternalTable(name)) {
          park(stmt)
        } else {
          ensureTable(name).createStatement = stmt
        }
        break
      }

      case 'insert': {
        const name = nameAfter(clean, INSERT_PREFIX)
        if (name === null) {
          park(stmt)
          break
        }
        preambleComplete = true
        if (isInternalTable(name)) {
          park(stmt)
        } else {
          ensureTable(name).dataStatements.push(stmt)
        }
        break
      }

      case 'delete': {
        const name = nameAfter(clean, DELETE_PREFIX)
        preambleComplete = true
        if (name !== null && isInternalTable(name)) {
          park(stmt)
        } else if (name !== null && tables.has(name)) {
          ;(tables.get(name) as Table).preDataStatements.push(stmt)
        } else {
          park(stmt)
        }
        break
      }

      case 'create_index':
      case 'create_trigger': {
        preambleComplete = true
        const owner = nameAfter(clean, ON_PREFIX)
        if (owner !== null && !isInternalTable(owner) && tables.has(owner)) {
          ;(tables.get(owner) as Table).postDataStatements.push(stmt)
        } else {
          park(stmt)
        }
        break
      }

      case 'create_view':
      case 'drop_table':
      case 'drop_index':
      case 'drop_trigger':
      case 'drop_view':
      case 'analyze':
      case 'unknown':
      case 'pragma':
      case 'begin':
      case 'commit':
      case 'rollback':
      case 'comment': {
        park(stmt)
        break
      }
    }
  }

  return {
    format,
    databases: [database],
    preamble: preamble.trimEnd(),
    postamble: postamble.trimEnd(),
  }
}

function readColumns(createStatement: string): string[] {
  return readColumnsShared(createStatement, SQLITE_DIALECT)
}

function readDataBlock(statement: string): DataBlock {
  return readInsertBlock(statement, SQLITE_DIALECT)
}

function countDataRows(statement: string): number {
  return countInsertRows(statement, SQLITE_DIALECT)
}

export type SqliteFamilyFormat = Extract<DatabaseFormat, 'sqlite' | 'duckdb'>

export function createSqliteParser(format: SqliteFamilyFormat): FormatParser {
  return {
    format,
    parse: (sql) => parseSqliteDump(sql, format),
    readColumns,
    readDataBlock,
    countDataRows,
  }
}

export const sqliteParser: FormatParser = createSqliteParser('sqlite')
