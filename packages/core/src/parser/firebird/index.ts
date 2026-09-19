import type { SqlDump, Database, Table } from '../../types/index.js'
import type { FormatParser } from '../shared/format-parser.js'
import { FIREBIRD_DIALECT, splitScript } from '../shared/dialect.js'
import {
  countInsertRows,
  readColumns as readColumnsWith,
  readInsertBlock,
} from '../shared/script-parser.js'
import { stripLeadingComments } from '../shared/syntax.js'
import { IDENT, displayName, identAfter, normalizeKey } from './identifiers.js'
import { findGeneratorOwners } from './generators.js'

const FALLBACK_DATABASE_NAME = 'database'

type StatementType =
  | 'comment'
  | 'create_database'
  | 'create_generator'
  | 'create_table'
  | 'create_trigger'
  | 'insert'
  | 'alter_table'
  | 'create_index'
  | 'unknown'

function classify(sql: string): StatementType {
  const clean = stripLeadingComments(sql)
  if (clean.length === 0) return 'comment'

  if (/^CREATE\s+DATABASE\b/i.test(clean)) return 'create_database'
  if (/^CREATE\s+(?:GENERATOR|SEQUENCE)\b/i.test(clean))
    return 'create_generator'
  if (/^CREATE\s+TABLE\b/i.test(clean)) return 'create_table'
  if (/^CREATE\s+(?:OR\s+ALTER\s+)?TRIGGER\b/i.test(clean))
    return 'create_trigger'
  if (/^INSERT\s+INTO\b/i.test(clean)) return 'insert'
  if (/^ALTER\s+TABLE\b/i.test(clean)) return 'alter_table'
  if (
    /^CREATE\s+(?:UNIQUE\s+)?(?:ASC(?:ENDING)?\s+|DESC(?:ENDING)?\s+)?INDEX\b/i.test(
      clean,
    )
  ) {
    return 'create_index'
  }

  return 'unknown'
}

function databaseNameFromCreate(clean: string): string | null {
  const match = clean.match(/CREATE\s+DATABASE\s+'([^']+)'/i)
  if (!match) return null

  const path = match[1] as string
  const base = path.split(/[\\/]/).pop() ?? path
  const stem = base.replace(/\.[^.]+$/, '')
  return stem.length > 0 ? stem : null
}

export function parseFirebirdDump(sql: string): SqlDump {
  const statements = splitScript(sql, FIREBIRD_DIALECT)
  const generatorOwners = findGeneratorOwners(statements)

  let database: Database | null = null
  const tables = new Map<string, Table>()
  const pendingPreData = new Map<string, string[]>()

  let preamble = ''
  let postamble = ''

  function ensureDatabase(): Database {
    if (!database) {
      database = {
        name: FALLBACK_DATABASE_NAME,
        createStatement: '',
        useStatement: '',
        tables: [],
      }
    }
    return database
  }

  function park(stmt: string): void {
    if (database) postamble += stmt + '\n'
    else preamble += stmt + '\n'
  }

  function ensureTable(raw: string): Table {
    const key = normalizeKey(raw)
    const existing = tables.get(key)
    if (existing) return existing

    const db = ensureDatabase()
    const created: Table = {
      name: displayName(raw),
      database: db.name,
      format: 'firebird',
      createStatement: '',
      preDataStatements: [],
      dataStatements: [],
      postDataStatements: [],
    }
    db.tables.push(created)
    tables.set(key, created)

    const buffered = pendingPreData.get(key)
    if (buffered) {
      created.preDataStatements.push(...buffered)
      pendingPreData.delete(key)
    }

    return created
  }

  function attachOrBuffer(rawTable: string, stmt: string): void {
    const key = normalizeKey(rawTable)
    const existing = tables.get(key)
    if (existing) {
      existing.preDataStatements.push(stmt)
      return
    }
    const buffered = pendingPreData.get(key)
    if (buffered) buffered.push(stmt)
    else pendingPreData.set(key, [stmt])
  }

  for (const stmt of statements) {
    const clean = stripLeadingComments(stmt)
    const type = classify(stmt)

    switch (type) {
      case 'create_database': {
        const name = databaseNameFromCreate(clean) ?? FALLBACK_DATABASE_NAME
        if (database) {
          database.name = name
          database.createStatement = stmt
        } else {
          database = {
            name,
            createStatement: stmt,
            useStatement: '',
            tables: [],
          }
        }
        break
      }

      case 'create_table': {
        const raw = identAfter(
          clean,
          String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`,
        )
        if (raw) {
          const table = ensureTable(raw)
          table.createStatement = stmt
        } else {
          park(stmt)
        }
        break
      }

      case 'create_generator': {
        const raw = identAfter(
          clean,
          String.raw`CREATE\s+(?:GENERATOR|SEQUENCE)\s+(?:IF\s+NOT\s+EXISTS\s+)?`,
        )
        const owner = raw ? generatorOwners.get(normalizeKey(raw)) : undefined
        if (owner) {
          attachOrBuffer(owner, stmt)
        } else {
          park(stmt)
        }
        break
      }

      case 'create_trigger': {
        const raw = identAfter(
          clean,
          String.raw`CREATE\s+(?:OR\s+ALTER\s+)?TRIGGER\s+` +
            IDENT +
            String.raw`\s+FOR`,
        )
        if (raw) {
          attachOrBuffer(raw, stmt)
        } else {
          park(stmt)
        }
        break
      }

      case 'insert': {
        const raw = identAfter(clean, String.raw`INSERT\s+INTO\s+`)
        if (raw) {
          ensureTable(raw).dataStatements.push(stmt)
        } else {
          park(stmt)
        }
        break
      }

      case 'alter_table': {
        const raw = identAfter(clean, String.raw`ALTER\s+TABLE\s+`)
        const existing = raw ? tables.get(normalizeKey(raw)) : undefined
        if (existing) {
          existing.postDataStatements.push(stmt)
        } else {
          park(stmt)
        }
        break
      }

      case 'create_index': {
        const raw = identAfter(clean, String.raw`\bON\s+`)
        const existing = raw ? tables.get(normalizeKey(raw)) : undefined
        if (existing) {
          existing.postDataStatements.push(stmt)
        } else {
          park(stmt)
        }
        break
      }

      case 'comment':
      case 'unknown': {
        park(stmt)
        break
      }
    }
  }

  return {
    format: 'firebird',
    databases: database ? [database] : [],
    preamble: preamble.trimEnd(),
    postamble: postamble.trimEnd(),
  }
}

function readColumns(createStatement: string): string[] {
  return readColumnsWith(createStatement, FIREBIRD_DIALECT)
}

function readDataBlock(statement: string) {
  return readInsertBlock(statement, FIREBIRD_DIALECT)
}

function countDataRows(statement: string): number {
  return countInsertRows(statement, FIREBIRD_DIALECT)
}

export const firebirdParser: FormatParser = {
  format: 'firebird',
  parse: parseFirebirdDump,
  readColumns,
  readDataBlock,
  countDataRows,
}
