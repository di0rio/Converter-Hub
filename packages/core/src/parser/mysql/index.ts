import type { SqlDump, Database, Table } from '../../types/index.js'
import type { DatabaseFormat } from '../../formats/index.js'
import type { FormatParser } from '../shared/format-parser.js'
import { stripLeadingComments } from '../shared/syntax.js'
import { readColumns, readDataBlock, countDataRows } from './rows.js'

export type MysqlFamilyFormat = Extract<
  DatabaseFormat,
  | 'mysql'
  | 'mariadb'
  | 'tidb'
  | 'percona'
  | 'aurora-mysql'
  | 'singlestore'
  | 'starrocks'
>

function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''

  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false

  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    const next = i + 1 < sql.length ? sql[i + 1] : undefined

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false
        current += ch
      } else {
        current += ch
      }
      i++
      continue
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        current += '*/'
        inBlockComment = false
        i += 2
        continue
      } else {
        current += ch
      }
      i++
      continue
    }

    if (inSingleQuote) {
      current += ch
      if (ch === "'" && next === "'") {
        current += next
        i += 2
      } else if (ch === "'") {
        inSingleQuote = false
        i++
      } else if (ch === '\\') {
        if (next !== undefined) {
          current += next
          i += 2
        } else {
          i++
        }
      } else {
        i++
      }
      continue
    }

    if (inDoubleQuote) {
      current += ch
      if (ch === '"' && next === '"') {
        current += next
        i += 2
      } else if (ch === '"') {
        inDoubleQuote = false
        i++
      } else if (ch === '\\') {
        if (next !== undefined) {
          current += next
          i += 2
        } else {
          i++
        }
      } else {
        i++
      }
      continue
    }

    if (inBacktick) {
      current += ch
      if (ch === '`' && next === '`') {
        current += next
        i += 2
      } else if (ch === '`') {
        inBacktick = false
        i++
      } else {
        i++
      }
      continue
    }

    if (ch === '-' && next === '-') {
      inLineComment = true
      current += '--'
      i += 2
      continue
    }
    if (ch === '#') {
      inLineComment = true
      current += '#'
      i++
      continue
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true
      current += '/*'
      i += 2
      continue
    }

    if (ch === "'") {
      inSingleQuote = true
      current += ch
      i++
      continue
    }

    if (ch === '"') {
      inDoubleQuote = true
      current += ch
      i++
      continue
    }

    if (ch === '`') {
      inBacktick = true
      current += ch
      i++
      continue
    }

    if (ch === ';') {
      current += ';'
      const trimmed = current.trim()
      if (trimmed.length > 0) {
        statements.push(trimmed)
      }
      current = ''
      i++
      continue
    }

    current += ch
    i++
  }

  const trimmed = current.trim()
  if (trimmed.length > 0) {
    statements.push(trimmed)
  }

  return statements
}

type StatementType =
  | 'comment'
  | 'set'
  | 'create_database'
  | 'use'
  | 'create_table'
  | 'drop_table'
  | 'insert'
  | 'lock'
  | 'unlock'
  | 'create_index'
  | 'unknown'

function classifyStatement(sql: string): StatementType {
  const trimmed = sql.trimStart()

  if (/^\/\*M?!/.test(trimmed)) {
    const endIdx = trimmed.indexOf('*/')
    if (endIdx !== -1) {
      const inner = trimmed.slice(0, endIdx + 2)
      const innerSql = inner.replace(/^\/\*M?!\d+\s*/, '')
      const upper = innerSql.toUpperCase()
      if (/^SET\b/.test(upper)) return 'set'
      if (/^USE\b/.test(upper)) return 'use'
    }
    return 'comment'
  }

  const clean = stripLeadingComments(sql)
  const upper = clean.toUpperCase()

  if (/^--/.test(clean) || /^#/.test(clean) || /^\/\*/.test(clean)) {
    return 'comment'
  }

  if (/^SET\b/i.test(clean)) return 'set'
  if (/^CREATE\s+DATABASE\b/i.test(clean)) return 'create_database'
  if (/^USE\b/i.test(clean)) return 'use'
  if (/^CREATE\s+TABLE\b/i.test(clean)) return 'create_table'
  if (/^DROP\s+TABLE\b/i.test(clean)) return 'drop_table'
  if (/^INSERT\s+INTO\b/i.test(clean)) return 'insert'
  if (/^LOCK\s+TABLES\b/i.test(clean)) return 'lock'
  if (/^UNLOCK\s+TABLES\b/i.test(clean)) return 'unlock'
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(clean)) return 'create_index'

  return 'unknown'
}

function databaseNameFromCreate(sql: string): string | null {
  const match = stripLeadingComments(sql).match(
    /CREATE\s+DATABASE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/i,
  )
  return match?.[1] ?? null
}

function databaseNameFromUse(sql: string): string | null {
  const match = stripLeadingComments(sql).match(/USE\s+[`"]?(\w+)[`"]?/i)
  return match?.[1] ?? null
}

function tableNameFromCreate(sql: string): string | null {
  const match = stripLeadingComments(sql).match(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/i,
  )
  return match?.[1] ?? null
}

function tableNameFromInsert(sql: string): string | null {
  const match = stripLeadingComments(sql).match(
    /INSERT\s+INTO\s+[`"]?(\w+)[`"]?/i,
  )
  return match?.[1] ?? null
}

function databaseNameFromHeader(sql: string): string | null {
  const match = sql.match(/^--\s*Host:.*?Database:\s*([A-Za-z0-9_$]+)/im)
  return match?.[1] ?? null
}

export function parseMysqlDump(
  sql: string,
  format: MysqlFamilyFormat = 'mysql',
): SqlDump {
  const statements = splitStatements(sql)

  const databases: Database[] = []
  let preamble = ''
  let postamble = ''

  let currentDatabase: Database | null = null
  let currentTable: Table | null = null
  let preambleComplete = false

  const fallbackDatabaseName = databaseNameFromHeader(sql) ?? 'database'

  function ensureDatabase(): Database {
    if (!currentDatabase) {
      currentDatabase = {
        name: fallbackDatabaseName,
        createStatement: '',
        useStatement: '',
        tables: [],
      }
      preambleComplete = true
    }
    return currentDatabase
  }

  function flushCurrentTable() {
    if (currentTable && currentDatabase) {
      currentDatabase.tables.push(currentTable)
      currentTable = null
    }
  }

  function flushCurrentDatabase() {
    flushCurrentTable()
    if (currentDatabase) {
      databases.push(currentDatabase)
      currentDatabase = null
    }
  }

  for (const stmt of statements) {
    const type = classifyStatement(stmt)

    switch (type) {
      case 'create_database': {
        flushCurrentDatabase()
        const name = databaseNameFromCreate(stmt)
        if (name) {
          currentDatabase = {
            name,
            createStatement: stmt,
            useStatement: '',
            tables: [],
          }
          preambleComplete = true
        }
        break
      }

      case 'use': {
        const name = databaseNameFromUse(stmt)
        if (name) {
          if (currentDatabase) {
            currentDatabase.useStatement = stmt
          } else {
            flushCurrentDatabase()
            currentDatabase = {
              name,
              createStatement: '',
              useStatement: stmt,
              tables: [],
            }
          }
          preambleComplete = true
        }
        break
      }

      case 'create_table': {
        flushCurrentTable()
        const tableName = tableNameFromCreate(stmt)
        if (tableName) {
          const db = ensureDatabase()
          currentTable = {
            name: tableName,
            database: db.name,
            format,
            createStatement: stmt,
            preDataStatements: [],
            dataStatements: [],
            postDataStatements: [],
          }
        }
        break
      }

      case 'drop_table': {
        break
      }

      case 'insert': {
        if (currentTable) {
          currentTable.dataStatements.push(stmt)
        } else {
          const tableName = tableNameFromInsert(stmt)
          if (tableName) {
            const currentDatabase = ensureDatabase()
            const existing = currentDatabase.tables.find(
              (t) => t.name === tableName,
            )
            if (existing) {
              existing.dataStatements.push(stmt)
            } else {
              const placeholder: Table = {
                name: tableName,
                database: currentDatabase.name,
                format,
                createStatement: '',
                preDataStatements: [],
                dataStatements: [stmt],
                postDataStatements: [],
              }
              currentDatabase.tables.push(placeholder)
            }
          }
        }
        break
      }

      case 'lock': {
        if (currentTable) {
          currentTable.preDataStatements.push(stmt)
        }
        break
      }

      case 'unlock': {
        if (currentTable) {
          currentTable.postDataStatements.push(stmt)
          flushCurrentTable()
        }
        break
      }

      case 'create_index': {
        if (currentTable) {
          currentTable.postDataStatements.push(stmt)
        }
        break
      }

      case 'set': {
        if (!preambleComplete) {
          preamble += stmt + '\n'
        } else {
          postamble += stmt + '\n'
        }
        break
      }

      case 'comment': {
        if (!preambleComplete) {
          preamble += stmt + '\n'
        } else if (!currentDatabase) {
          postamble += stmt + '\n'
        }
        break
      }

      case 'unknown': {
        if (!preambleComplete) {
          preamble += stmt + '\n'
        } else if (!currentDatabase) {
          postamble += stmt + '\n'
        }
        break
      }
    }
  }

  flushCurrentDatabase()

  return {
    format,
    databases,
    preamble: preamble.trimEnd(),
    postamble: postamble.trimEnd(),
  }
}

export function createMysqlParser(format: MysqlFamilyFormat): FormatParser {
  return {
    format,
    parse: (sql) => parseMysqlDump(sql, format),
    readColumns,
    readDataBlock,
    countDataRows,
  }
}
