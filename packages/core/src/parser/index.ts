import type { SqlDump, Database, Table } from '../types/index.js'

/**
 * Split SQL into statements, respecting string literals, backtick identifiers,
 * and comments. Splits on `;` only when in normal (unquoted) state.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''

  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false
  let inLineComment = false // -- or #
  let inBlockComment = false

  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    const next = i + 1 < sql.length ? sql[i + 1] : undefined

    // Inside a line comment — consume until newline
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

    // Inside a block comment — consume until */
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

    // Inside a single-quoted string
    if (inSingleQuote) {
      current += ch
      if (ch === "'" && next === "'") {
        // Escaped single quote
        current += next
        i += 2
      } else if (ch === "'") {
        inSingleQuote = false
        i++
      } else if (ch === '\\') {
        // Backslash escape — consume next char
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

    // Inside a double-quoted string
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

    // Inside a backtick identifier
    if (inBacktick) {
      current += ch
      if (ch === '`' && next === '`') {
        // Escaped backtick
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

    // Normal state — detect transitions

    // Check for single-line comment start: -- or #
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

    // Check for block comment start: /*
    if (ch === '/' && next === '*') {
      inBlockComment = true
      current += '/*'
      i += 2
      continue
    }

    // Check for single quote
    if (ch === "'") {
      inSingleQuote = true
      current += ch
      i++
      continue
    }

    // Check for double quote
    if (ch === '"') {
      inDoubleQuote = true
      current += ch
      i++
      continue
    }

    // Check for backtick
    if (ch === '`') {
      inBacktick = true
      current += ch
      i++
      continue
    }

    // Statement terminator
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

    // Regular character
    current += ch
    i++
  }

  // Push any remaining content
  const trimmed = current.trim()
  if (trimmed.length > 0) {
    statements.push(trimmed)
  }

  return statements
}

/**
 * Strip leading comment lines from a statement, returning the remaining SQL.
 * Handles --, #, and /* ... *​/ comments at the start of a statement.
 */
function stripLeadingComments(sql: string): string {
  let rest = sql.trimStart()

  while (true) {
    // -- single line comment
    if (rest.startsWith('--')) {
      const newlineIdx = rest.indexOf('\n')
      rest = newlineIdx === -1 ? '' : rest.slice(newlineIdx + 1)
      rest = rest.trimStart()
      continue
    }

    // # single line comment
    if (rest.startsWith('#')) {
      const newlineIdx = rest.indexOf('\n')
      rest = newlineIdx === -1 ? '' : rest.slice(newlineIdx + 1)
      rest = rest.trimStart()
      continue
    }

    // /* block comment */
    if (rest.startsWith('/*')) {
      const endIdx = rest.indexOf('*/')
      rest = endIdx === -1 ? '' : rest.slice(endIdx + 2)
      rest = rest.trimStart()
      continue
    }

    break
  }

  return rest
}

/**
 * Classify a statement into a type based on its leading keywords.
 */
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

  // Handle conditional comments /*!40101 ... */ — these execute on matching versions
  // Extract the SQL inside and classify based on it
  if (/^\/\*!/.test(trimmed)) {
    const endIdx = trimmed.indexOf('*/')
    if (endIdx !== -1) {
      const inner = trimmed.slice(0, endIdx + 2)
      const innerSql = inner.replace(/^\/\*!\d+\s*/, '')
      const upper = innerSql.toUpperCase()
      if (/^SET\b/.test(upper)) return 'set'
      if (/^USE\b/.test(upper)) return 'use'
    }
    return 'comment'
  }

  // Strip leading comments to find the actual SQL command
  const clean = stripLeadingComments(sql)
  const upper = clean.toUpperCase()

  // Pure comments (only comment content, no SQL after)
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

/**
 * Extract a database name from a CREATE DATABASE statement.
 * Handles: CREATE DATABASE [IF NOT EXISTS] `name` or unquoted name.
 */
function extractDatabaseNameFromCreate(sql: string): string | null {
  const match = stripLeadingComments(sql).match(
    /CREATE\s+DATABASE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/i
  )
  return match?.[1] ?? null
}

/**
 * Extract a database name from a USE statement.
 */
function extractDatabaseNameFromUse(sql: string): string | null {
  const match = stripLeadingComments(sql).match(/USE\s+[`"]?(\w+)[`"]?/i)
  return match?.[1] ?? null
}

/**
 * Extract a table name from a CREATE TABLE statement.
 */
function extractTableNameFromCreate(sql: string): string | null {
  const match = stripLeadingComments(sql).match(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/i
  )
  return match?.[1] ?? null
}

/**
 * Extract a table name from a DROP TABLE statement.
 */
function extractTableNameFromDrop(sql: string): string | null {
  const match = stripLeadingComments(sql).match(
    /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)[`"]?/i
  )
  return match?.[1] ?? null
}

/**
 * Extract a table name from an INSERT INTO statement.
 */
function extractTableNameFromInsert(sql: string): string | null {
  const match = stripLeadingComments(sql).match(
    /INSERT\s+INTO\s+[`"]?(\w+)[`"]?/i
  )
  return match?.[1] ?? null
}

/**
 * Extract a table name from a LOCK TABLES statement.
 */
function extractTableNameFromLock(sql: string): string | null {
  const match = stripLeadingComments(sql).match(
    /LOCK\s+TABLES\s+[`"]?(\w+)[`"]?/i
  )
  return match?.[1] ?? null
}

/**
 * Recover a database name from the mysqldump header comment.
 * `mysqldump <db>` writes "-- Host: localhost    Database: shop" but emits no
 * CREATE DATABASE or USE statement, so this is the only name available.
 */
function extractDatabaseNameFromHeader(sql: string): string | null {
  const match = sql.match(/^--\s*Host:.*?Database:\s*([A-Za-z0-9_$]+)/im)
  return match?.[1] ?? null
}

/**
 * Parse a MySQL/MariaDB SQL dump string into a structured SqlDump.
 */
export function parseSqlDump(sql: string): SqlDump {
  const statements = splitStatements(sql)

  const databases: Database[] = []
  let preamble = ''
  let postamble = ''

  let currentDatabase: Database | null = null
  let currentTable: Table | null = null
  let preambleComplete = false

  // A single-database dump (`mysqldump <db>`) carries no CREATE DATABASE and no
  // USE. Without a fallback its tables would have nowhere to attach and the dump
  // would parse as having zero databases.
  const fallbackDatabaseName = extractDatabaseNameFromHeader(sql) ?? 'database'

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
        const name = extractDatabaseNameFromCreate(stmt)
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
        const name = extractDatabaseNameFromUse(stmt)
        if (name) {
          // If we already have a current database but no tables were added,
          // this might be a repeated USE. Update the use statement.
          if (currentDatabase) {
            currentDatabase.useStatement = stmt
          } else {
            // Create a database entry if one doesn't exist yet
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
        const tableName = extractTableNameFromCreate(stmt)
        if (tableName) {
          const db = ensureDatabase()
          currentTable = {
            name: tableName,
            database: db.name,
            createStatement: stmt,
            insertStatements: [],
            indexes: [],
          }
        }
        break
      }

      case 'drop_table': {
        // Drop table is informational — we note it but keep going to CREATE TABLE
        // If there's a drop_table without a create_table following, it's still valid
        break
      }

      case 'insert': {
        if (currentTable) {
          currentTable.insertStatements.push(stmt)
        } else {
          // Insert without a preceding CREATE TABLE — try to find or create a table entry
          const tableName = extractTableNameFromInsert(stmt)
          if (tableName) {
            const currentDatabase = ensureDatabase()
            // Look for existing table in current database
            const existing = currentDatabase.tables.find(
              (t) => t.name === tableName
            )
            if (existing) {
              existing.insertStatements.push(stmt)
            } else {
              // Create a placeholder table entry
              const placeholder: Table = {
                name: tableName,
                database: currentDatabase.name,
                createStatement: '',
                insertStatements: [stmt],
                indexes: [],
              }
              currentDatabase.tables.push(placeholder)
            }
          }
        }
        break
      }

      case 'lock': {
        if (currentTable) {
          currentTable.lockStatement = stmt
        }
        break
      }

      case 'unlock': {
        if (currentTable) {
          currentTable.unlockStatement = stmt
          flushCurrentTable()
        }
        break
      }

      case 'create_index': {
        if (currentTable) {
          currentTable.indexes.push(stmt)
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
        // Comments before any database declaration go to preamble
        if (!preambleComplete) {
          preamble += stmt + '\n'
        } else if (!currentDatabase) {
          postamble += stmt + '\n'
        }
        // Comments within a database/table context are preserved with the SQL
        // They're already embedded in the stored statement text
        break
      }

      case 'unknown': {
        // Unknown statements after a database are postamble
        if (!preambleComplete) {
          preamble += stmt + '\n'
        } else if (!currentDatabase) {
          postamble += stmt + '\n'
        }
        break
      }
    }
  }

  // Flush any remaining state
  flushCurrentDatabase()

  return {
    databases,
    preamble: preamble.trimEnd(),
    postamble: postamble.trimEnd(),
  }
}
