import type { TabularTable } from '../tabular/columns.js'
import { normalizeColumns } from '../tabular/columns.js'

/**
 * The shape a SQLite database takes once it has been read, and the conversions
 * that carry it into the writers the rest of the project already has.
 *
 * Nothing here opens a file or runs a query, and nothing here imports the
 * SQLite engine: that lives in `reader.ts`, which depends on this module and
 * never the other way round, so a tool that only formats values does not pull
 * WebAssembly into its bundle.
 */

/**
 * Thrown when a chosen file cannot be read, carrying a message safe to show.
 *
 * The message never quotes the database's contents, a SQL statement or an
 * internal error string: a caught message can carry fragments of the user's
 * data, and this tool never puts those on screen.
 */
export class SqliteReadError extends Error {}

// ------------------------------------------------------------------- types

/**
 * One stored value, in SQLite's five storage classes.
 *
 * SQLite is dynamically typed: a column's declared type is an affinity, not a
 * constraint, and any row may store any class. The reader reports what was
 * actually stored rather than what the column claims.
 *
 * `bigint` is not a sixth class. It is how a 64-bit INTEGER too large for a
 * JavaScript number arrives without being rounded.
 */
export type SqliteValue = null | number | bigint | string | Uint8Array

export interface SqliteColumn {
  name: string
  /** The type named in the DDL. May be empty: SQLite does not require one. */
  declaredType: string
  primaryKey: boolean
  notNull: boolean
}

export interface SqliteTable {
  name: string
  /** The original `CREATE TABLE`, exactly as SQLite stored it. */
  createStatement: string
  columns: SqliteColumn[]
  rows: SqliteValue[][]
  /** Total rows in the table, which may exceed the rows carried here. */
  rowCount: number
  /** The original `CREATE INDEX` statements belonging to this table. */
  indexStatements: string[]
}

export interface SqliteDatabase {
  tables: SqliteTable[]
  /** Tables that exist but cannot be read as ordinary tables. */
  unreadable: UnreadableTable[]
}

export interface UnreadableTable {
  name: string
  reason: 'virtual'
}

// ------------------------------------------------------------------ base64

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Base64 without depending on `Buffer` or `btoa`.
 *
 * The core runs in a browser, in Bun and under Node, and the three do not agree
 * on which of those exists. Twelve lines are cheaper than branching on the host.
 */
function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(triple >> 18) & 63] as string
    out += B64[(triple >> 12) & 63] as string
    out += b === undefined ? '=' : (B64[(triple >> 6) & 63] as string)
    out += c === undefined ? '=' : (B64[triple & 63] as string)
  }
  return out
}

// ------------------------------------------------------------- conversions

/**
 * One stored value as text, for CSV, XLSX, JSON and Markdown.
 *
 * NULL stays `null` — writers distinguish it from an empty string, and SQLite
 * does too. A BLOB becomes base64, which is the only representation that
 * survives a text file without inventing or dropping bytes; the README says so
 * next to the format list.
 *
 * Nothing is interpreted on the way through. SQLite has no date type, so an
 * INTEGER that happens to look like a Unix timestamp and a TEXT that happens to
 * look like a date are left exactly as they were stored — guessing wrong there
 * silently rewrites the user's data.
 */
export function toCellText(value: SqliteValue): string | null {
  if (value === null) return null
  if (value instanceof Uint8Array) return toBase64(value)
  if (typeof value === 'string') return value
  return String(value)
}

/**
 * One stored value as a SQL literal.
 *
 * Doubling an embedded quote is SQLite's only string escape, so a value
 * carrying `'); DROP TABLE t; --` survives as text rather than as syntax. A
 * BLOB is written `X'hex'`, which SQLite reads back as the same bytes — the
 * reason the SQL export uses it rather than the base64 the text formats get.
 *
 * Infinity and NaN have no SQLite literal. `sqlite3` itself writes them as
 * NULL, and matching that keeps the script replayable.
 */
export function toSqlLiteral(value: SqliteValue): string {
  if (value === null) return 'NULL'
  if (value instanceof Uint8Array) {
    let hex = ''
    for (const byte of value) hex += byte.toString(16).padStart(2, '0')
    return "X'" + hex + "'"
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL'
  }
  if (typeof value === 'bigint') return String(value)
  return "'" + value.replace(/'/g, "''") + "'"
}

/** A double-quoted identifier, the form SQLite itself emits. */
function identifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

/**
 * A table in the shape every existing writer takes.
 *
 * Column names go through `normalizeColumns` for the same reason spreadsheet
 * sheets do: a table may declare two columns whose names collide once a writer
 * treats them as headers.
 */
export function sqliteToTabular(table: SqliteTable): TabularTable {
  return {
    name: table.name,
    columns: normalizeColumns(table.columns.map((c) => c.name)),
    rows: table.rows.map((row) => row.map(toCellText)),
  }
}

/**
 * Rows per INSERT.
 *
 * One statement per row is slow to replay; one statement for a hundred thousand
 * rows overruns the statement-length limits. This is the batch size the
 * spreadsheet writer already settled on.
 */
const ROWS_PER_INSERT = 500

/**
 * A database as a SQL script: the schema SQLite stored, then the rows.
 *
 * The `CREATE TABLE` is copied verbatim from `sqlite_master` rather than
 * rebuilt, so primary keys, constraints, collations and declared types survive
 * without this file having to understand any of them. Indexes follow the rows,
 * which is both what `sqlite3 .dump` does and cheaper to replay.
 *
 * Nothing here executes SQL. The output is text.
 */
export function sqliteToSql(tables: readonly SqliteTable[]): string {
  const lines = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;']
  const trailing: string[] = []

  for (const table of tables) {
    lines.push(table.createStatement.trimEnd().replace(/;$/, '') + ';')

    const columns = table.columns.map((c) => identifier(c.name)).join(',')
    for (let i = 0; i < table.rows.length; i += ROWS_PER_INSERT) {
      const batch = table.rows
        .slice(i, i + ROWS_PER_INSERT)
        .map((row) => '(' + row.map(toSqlLiteral).join(',') + ')')
        .join(',\n  ')
      lines.push(
        'INSERT INTO ' +
          identifier(table.name) +
          ' (' +
          columns +
          ') VALUES\n  ' +
          batch +
          ';',
      )
    }

    for (const index of table.indexStatements) {
      trailing.push(index.trimEnd().replace(/;$/, '') + ';')
    }
  }

  return [...lines, ...trailing, 'COMMIT;', ''].join('\n')
}

// ------------------------------------------------------------------- files

/** The companions SQLite writes beside a database, and what each one is. */
const SIDECAR = /^(.*)-(wal|shm)$/i

/** One database and the companions chosen with it. */
export interface SqliteFileGroup<T> {
  main: T
  /** Its write-ahead log. Its rows are read. */
  wal?: T | undefined
  /** Its shared-memory index, recognised so it can be ignored. */
  shm?: T | undefined
}

/**
 * Decide which of the chosen files make up one database.
 *
 * A database in WAL mode is up to three files that only mean something
 * together. Pairing is by name, never by position or count: `orders.db` and
 * `sessions.db-wal` are two databases, and reading one's log over the other's
 * pages would report rows that were never in the database the user named. The
 * browser passes file names and the CLI passes paths, so a log is also only
 * ever paired with the database in its own directory.
 *
 * The `-shm` is accepted and ignored. It holds no data of its own — SQLite
 * rebuilds the index in memory — so requiring it would turn a readable
 * selection into an error for nothing.
 */
export function groupSqliteFiles<T extends { name: string }>(
  files: readonly T[],
): SqliteFileGroup<T> {
  const mains: T[] = []
  const sidecars: { base: string; kind: string; file: T }[] = []

  for (const file of files) {
    const match = SIDECAR.exec(file.name)
    if (match) {
      sidecars.push({
        base: (match[1] as string).toLowerCase(),
        kind: (match[2] as string).toLowerCase(),
        file,
      })
    } else {
      mains.push(file)
    }
  }

  if (mains.length === 0) {
    throw new SqliteReadError(
      sidecars.length > 0
        ? 'Only SQLite companion files were selected. Add the database file itself — the one without a -wal or -shm suffix.'
        : 'No file was selected.',
    )
  }
  if (mains.length > 1) {
    throw new SqliteReadError(
      'Select one database at a time, together with its -wal and -shm files if it has them.',
    )
  }

  const main = mains[0] as T
  const key = main.name.toLowerCase()
  const owned = sidecars.filter((s) => s.base === key)

  if (owned.length !== sidecars.length) {
    throw new SqliteReadError(
      'Some selected -wal or -shm files belong to a different database. Select the files that share one database name.',
    )
  }

  return {
    main,
    wal: owned.find((s) => s.kind === 'wal')?.file,
    shm: owned.find((s) => s.kind === 'shm')?.file,
  }
}
