import type { SqlDump, Database, Table } from '../../types/index.js'
import type { DatabaseFormat } from '../../formats/index.js'
import type { FormatParser } from '../shared/format-parser.js'
import { stripLeadingComments } from '../shared/syntax.js'
import { splitStatements, qualifiedNameAfter, unquote } from './lexer.js'
import { readColumns, readDataBlock, countDataRows } from './rows.js'

/**
 * The schema PostgreSQL puts an unqualified table in. A dump of a single
 * database usually never writes the word, so it has to be supplied.
 */
const DEFAULT_SCHEMA = 'public'

type StatementType =
  | 'comment'
  | 'set'
  | 'search_path'
  | 'create_database'
  | 'connect'
  | 'create_schema'
  | 'create_table'
  | 'copy'
  | 'insert'
  | 'alter_table'
  | 'create_index'
  | 'sequence'
  | 'meta'
  | 'unknown'

function classifyStatement(sql: string): StatementType {
  const clean = stripLeadingComments(sql)

  if (clean.length === 0) return 'comment'
  if (clean.startsWith('\\')) {
    return /^\\(connect|c)\b/i.test(clean) ? 'connect' : 'meta'
  }

  if (/^SET\s+search_path\b/i.test(clean)) return 'search_path'
  if (
    /^SELECT\s+(?:pg_catalog\.)?set_config\s*\(\s*'search_path'/i.test(clean)
  ) {
    return 'search_path'
  }
  if (/^SET\b/i.test(clean)) return 'set'
  if (/^CREATE\s+DATABASE\b/i.test(clean)) return 'create_database'
  if (/^CREATE\s+SCHEMA\b/i.test(clean)) return 'create_schema'
  if (/^CREATE\s+(?:UNLOGGED\s+)?TABLE\b/i.test(clean)) return 'create_table'
  if (/^COPY\b/i.test(clean)) return 'copy'
  if (/^INSERT\s+INTO\b/i.test(clean)) return 'insert'
  if (/^ALTER\s+TABLE\b/i.test(clean)) return 'alter_table'
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(clean)) return 'create_index'
  if (/^(CREATE|ALTER|DROP)\s+SEQUENCE\b/i.test(clean)) return 'sequence'
  if (/^SELECT\s+(?:pg_catalog\.)?setval\s*\(/i.test(clean)) return 'sequence'

  return 'unknown'
}

/** A sequence name as the dump writes it, schema included when it gives one. */
function qualify(name: { schema: string | null; name: string }): string {
  return name.schema ? name.schema + '.' + name.name : name.name
}

/** The sequence a CREATE/ALTER SEQUENCE or setval() statement acts on. */
function sequenceNamedBy(sql: string): string | null {
  const clean = stripLeadingComments(sql)

  const declared = qualifiedNameAfter(
    clean,
    String.raw`(?:CREATE|ALTER|DROP)\s+SEQUENCE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?`,
  )
  if (declared) return qualify(declared)

  const setval = clean.match(/setval\s*\(\s*'([^']+)'/i)
  return setval ? setval[1] : null
}

/**
 * Map every sequence in the dump to the table that owns it.
 *
 * A dump connects the two only in `ALTER SEQUENCE ... OWNED BY t.c` and in the
 * `nextval` default on a column, and both can appear after the CREATE SEQUENCE
 * they explain. Reading them up front lets the walk attach each sequence
 * statement to its table as it goes, which is what keeps a partial export from
 * carrying sequences belonging to tables the user did not select.
 */
function readSequenceOwners(statements: string[]): Map<string, string> {
  const owners = new Map<string, string>()

  for (const stmt of statements) {
    const clean = stripLeadingComments(stmt)

    const owned = clean.match(
      /ALTER\s+SEQUENCE\s+(\S+)\s+OWNED\s+BY\s+([^\s;]+)/i,
    )
    if (owned) {
      // schema.table.column, or table.column when the dump left it unqualified.
      const path = owned[2].split('.')
      if (path.length >= 2) {
        owners.set(unquote(owned[1]), path.slice(0, -1).map(unquote).join('.'))
      }
      continue
    }

    const nextval = clean.match(
      /ALTER\s+TABLE\s+(?:ONLY\s+)?(\S+)[\s\S]*?nextval\s*\(\s*'([^']+)'/i,
    )
    if (nextval) {
      owners.set(
        unquote(nextval[2].replace(/::.*$/, '')),
        nextval[1].split('.').map(unquote).join('.'),
      )
    }
  }

  return owners
}

/** `SET search_path = app, public;` — the first entry is where tables land. */
function searchPathSchema(sql: string): string | null {
  const match = stripLeadingComments(sql).match(
    /SET\s+search_path\s*(?:=|TO)\s*([^;]+)/i,
  )
  if (!match) return null

  const first = match[1].split(',')[0].trim()
  if (first.length === 0 || /^(''|""|DEFAULT)$/i.test(first)) return null

  const name = unquote(first)
  // pg_catalog first means "resolve nothing here"; it is never a table's home.
  return name.length > 0 && name !== 'pg_catalog' ? name : null
}

/**
 * Parse a PostgreSQL dump into a normalised SqlDump.
 *
 * A PostgreSQL dump groups tables by schema rather than by database, so each
 * `Database` here is a schema and carries the database it belongs to in
 * `catalog` when the dump names one. Statement text is stored verbatim; nothing
 * is executed.
 */
export function parsePostgresDump(
  sql: string,
  format: PostgresFamilyFormat = 'postgresql',
): SqlDump {
  const statements = splitStatements(sql)
  const sequenceOwners = readSequenceOwners(statements)

  const schemas = new Map<string, Database>()
  const tables = new Map<string, Table>()

  let preamble = ''
  let postamble = ''
  let preambleComplete = false

  let catalog: string | undefined
  let searchPath: string | null = null

  function schemaKey(schema: string, table: string): string {
    // NUL cannot occur in an identifier, so it is the one separator that
    // cannot make ("a b", "c") and ("a", "b c") collide. Written as an
    // escape: a raw control character here would be invisible to a reader
    // and lost to any tool that strips it.
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

  /** The table a statement names, creating an entry for it if it is new. */
  function tableNamedBy(sql: string, prefix: string): Table | null {
    const qualified = qualifiedNameAfter(sql, prefix)
    if (!qualified) return null
    return ensureTable(
      qualified.schema ?? searchPath ?? DEFAULT_SCHEMA,
      qualified.name,
    )
  }

  /** Look up a table written as `schema.table`, or as a bare `table`. */
  function tableAtPath(path: string): Table | null {
    const parts = path.split('.')
    const name = parts.pop() as string
    const schema = parts.pop() ?? searchPath ?? DEFAULT_SCHEMA
    return tables.get(schemaKey(schema, name)) ?? null
  }

  /**
   * The table a statement names, only if the dump already declared it. Trailing
   * DDL for a table that was never created belongs to the dump, not to a table
   * entry invented for it.
   */
  function existingTableNamedBy(sql: string, prefix: string): Table | null {
    const qualified = qualifiedNameAfter(sql, prefix)
    if (!qualified) return null
    const schema = qualified.schema ?? searchPath ?? DEFAULT_SCHEMA
    return tables.get(schemaKey(schema, qualified.name)) ?? null
  }

  /**
   * Park a statement that belongs to a table but is not its DDL or its rows.
   * Whether it has to run before or after the rows is decided by where the dump
   * put it, which is the only ordering information a dump carries.
   */
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
      case 'create_database': {
        const name = qualifiedNameAfter(stmt, String.raw`CREATE\s+DATABASE`)
        if (name) catalog = name.name
        park(stmt)
        break
      }

      case 'connect': {
        const match = stmt.match(/^\\(?:connect|c)\s+(\S+)/i)
        if (match) catalog = unquote(match[1].replace(/;$/, ''))
        park(stmt)
        break
      }

      case 'create_schema': {
        const name = qualifiedNameAfter(
          stmt,
          String.raw`CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?`,
        )
        if (name && name.name.toUpperCase() !== 'AUTHORIZATION') {
          ensureSchema(name.name).createStatement = stmt
        }
        break
      }

      case 'search_path': {
        searchPath = searchPathSchema(stmt)
        // A search_path that names a real schema also selects it, the way USE
        // does in MySQL. Recording it keeps the switch in the SQL export.
        if (searchPath && schemas.has(searchPath)) {
          const schema = schemas.get(searchPath)
          if (schema && schema.useStatement === '') schema.useStatement = stmt
        } else {
          park(stmt)
        }
        break
      }

      case 'create_table': {
        const qualified = qualifiedNameAfter(
          stmt,
          String.raw`CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`,
        )
        if (qualified) {
          const table = ensureTable(
            qualified.schema ?? searchPath ?? DEFAULT_SCHEMA,
            qualified.name,
          )
          table.createStatement = stmt
        }
        break
      }

      case 'copy':
      case 'insert': {
        const prefix =
          type === 'copy' ? String.raw`COPY` : String.raw`INSERT\s+INTO`
        const table = tableNamedBy(stmt, prefix)
        if (table) {
          table.dataStatements.push(stmt)
        } else {
          park(stmt)
        }
        break
      }

      case 'alter_table': {
        const table = existingTableNamedBy(
          stmt,
          String.raw`ALTER\s+TABLE\s+(?:ONLY\s+)?`,
        )
        if (table) {
          attach(table, stmt)
        } else {
          park(stmt)
        }
        break
      }

      case 'create_index': {
        const table = existingTableNamedBy(
          stmt,
          String.raw`\bON\s+(?:ONLY\s+)?`,
        )
        if (table) attach(table, stmt)
        else park(stmt)
        break
      }

      case 'sequence': {
        // A sequence only restores alongside the table that owns it, so it has
        // to travel with that table rather than with the dump.
        const sequence = sequenceNamedBy(stmt)
        const owner =
          sequence === null ? undefined : sequenceOwners.get(sequence)
        const table = owner === undefined ? null : tableAtPath(owner)

        if (table) attach(table, stmt)
        else park(stmt)
        break
      }

      case 'set':
      case 'comment':
      case 'meta':
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

/**
 * The engines whose dumps this parser reads.
 *
 * Each is a distinct product that emits pg_dump-shaped output. They share the
 * reader, but keep their own identity: a Greenplum dump is reported as
 * Greenplum, not silently relabelled PostgreSQL.
 */
export type PostgresFamilyFormat = Extract<
  DatabaseFormat,
  | 'postgresql'
  | 'cockroachdb'
  | 'yugabytedb'
  | 'greenplum'
  | 'redshift'
  | 'timescaledb'
  | 'citus'
  | 'enterprisedb'
>

/** One reader, one identity per product. */
export function createPostgresParser(
  format: PostgresFamilyFormat,
): FormatParser {
  return {
    format,
    parse: (sql) => parsePostgresDump(sql, format),
    readColumns,
    readDataBlock,
    countDataRows,
  }
}

export const postgresParser: FormatParser = createPostgresParser('postgresql')
