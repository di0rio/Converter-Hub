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

/**
 * Parse the output of `sqlite3 mydb.db .dump`.
 *
 * SQLite has exactly one database and calls it `main` — that is SQLite's own
 * word, not a name invented here. There is never a CREATE DATABASE or USE
 * statement to read a name from, so this parser always produces exactly one
 * `Database` named `main`, whether or not the dump declares any tables.
 *
 * Statement text is stored verbatim; nothing here executes SQL.
 */

// ------------------------------------------------------------ identifiers

// SQLite accepts double-quoted, backtick, and bracketed identifiers, on top of
// a bare word. Building the pattern from plain strings (rather than a
// backtick-delimited template literal) avoids having to escape a backtick
// inside a template literal's own delimiter.
const DOUBLE_QUOTED = '"(?:[^"]|"")+"'
const BACK_QUOTED = '`(?:[^`]|``)+`'
const BRACKETED = '\\[[^\\]]*\\]'
const BARE = '[A-Za-z_][A-Za-z0-9_$]*'
const IDENTIFIER =
  '(?:' + DOUBLE_QUOTED + '|' + BACK_QUOTED + '|' + BRACKETED + '|' + BARE + ')'

/** The identifier that follows `prefix` (a regex source string), unquoted. */
function nameAfter(sql: string, prefix: string): string | null {
  const match = new RegExp(prefix + '\\s*(' + IDENTIFIER + ')', 'i').exec(sql)
  if (!match) return null
  return unquoteIdentifier(match[1] as string, SQLITE_SYNTAX)
}

const CREATE_TABLE_PREFIX =
  'CREATE\\s+(?:TEMP(?:ORARY)?\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?'
const INSERT_PREFIX = 'INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+'
const DELETE_PREFIX = 'DELETE\\s+FROM\\s+'
// CREATE INDEX and CREATE TRIGGER both name their owning table after `ON`.
const ON_PREFIX = '\\bON\\s+'

// ------------------------------------------------------------ statements

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

/**
 * `sqlite_sequence` (AUTOINCREMENT bookkeeping) and any other `sqlite_*`
 * table are SQLite's own internal state, not something a user asked to
 * export. They are excluded from the selectable table list, but their
 * statements are kept — verbatim, in the dump's postamble — so a full SQL
 * export still restores cleanly.
 */
function isInternalTable(name: string): boolean {
  return /^sqlite_/i.test(name)
}

/**
 * Parse a SQLite `.dump` script into a normalised SqlDump.
 */
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
          // A DELETE with no WHERE clears a table before it is repopulated —
          // that runs before the rows, alongside the rest of the setup.
          ;(tables.get(name) as Table).preDataStatements.push(stmt)
        } else {
          park(stmt)
        }
        break
      }

      // CREATE INDEX is always one statement, so it splits cleanly. CREATE
      // TRIGGER is classified the same way, but a trigger's BEGIN...END body
      // contains its own internal semicolons, which splitScript has no
      // notion of "batch" to protect (SQLite's dialect declares no
      // batchSeparator, dollarQuoting, or settableTerminator). A trigger
      // with a compound body will therefore be split into fragments at each
      // internal semicolon rather than kept as one statement — a known gap,
      // not exercised by the fixture or tests for this format.
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

      // A view can draw from more than one table, so it has no single owner
      // to attach to; it is preserved in the postamble instead.
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

// -------------------------------------------------------- FormatParser

function readColumns(createStatement: string): string[] {
  return readColumnsShared(createStatement, SQLITE_DIALECT)
}

function readDataBlock(statement: string): DataBlock {
  return readInsertBlock(statement, SQLITE_DIALECT)
}

function countDataRows(statement: string): number {
  return countInsertRows(statement, SQLITE_DIALECT)
}

/**
 * The engines whose dumps this parser reads. DuckDB's shell is forked from
 * SQLite's, so its .dump output has the same shape; the engine underneath is
 * a different product and is reported as one.
 */
export type SqliteFamilyFormat = Extract<DatabaseFormat, 'sqlite' | 'duckdb'>

/** One reader, one identity per product. */
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
