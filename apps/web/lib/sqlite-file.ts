import initSqlJs from 'sql.js'
import type { Database, SqlValue } from 'sql.js'

/**
 * Turn a binary SQLite database into the text of `sqlite3 mydb.db .dump`.
 *
 * The SQL tool's pipeline already reads that text end to end — detection,
 * parsing, preview and every export format. Rendering the binary into it means
 * a `.db` file rides the same path a dump does, and nothing downstream needs to
 * know the difference.
 *
 * SQLite stores each object's original DDL verbatim in `sqlite_master.sql`, so
 * the schema half of the dump is copied, not reconstructed. Only the rows are
 * written out here.
 */

/** The 16-byte header every SQLite database file opens with. */
const MAGIC = 'SQLite format 3\0'

/** Enough of the file to recognise it. */
export const SQLITE_MAGIC_BYTES = MAGIC.length

/**
 * Whether these opening bytes are a SQLite database.
 *
 * Read from the header rather than the extension: SQLite files are handed
 * around as `.db`, `.sqlite`, `.sqlite3` and plenty of application-specific
 * names, and a dump saved as `.db` is still text.
 */
export function isSqliteFile(head: ArrayBuffer): boolean {
  const bytes = new Uint8Array(head)
  if (bytes.length < MAGIC.length) return false
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) return false
  }
  return true
}

/**
 * A file the user chose that cannot be read, with a message explaining what to
 * do about it. Anything else thrown on the way is a genuine failure and keeps
 * the generic message.
 */
export class UnreadableFileError extends Error {}

/**
 * SQLite's write-ahead log header, in both byte orders the format allows.
 *
 * A WAL written on a big-endian machine opens with the second magic; the
 * checkpoint state that follows differs, but neither is a database.
 */
const WAL_MAGIC = [0x377f0682, 0x377f0683]

/**
 * Which of SQLite's companion files this is, if any.
 *
 * A database in WAL mode sits next to a `-wal` and a `-shm` file, and file
 * pickers list all three together, so choosing the wrong one is the easy
 * mistake. Neither is a database on its own: the `-shm` is a shared-memory
 * index that exists only while a process has the database open, and the `-wal`
 * holds pages not yet folded back in.
 *
 * The `-wal` is identified by its header. The `-shm` has no stable magic, so
 * its fixed naming convention is the signal — that convention is SQLite's own
 * and does not vary.
 */
function sqliteSidecar(name: string, head: ArrayBuffer): 'wal' | 'shm' | null {
  const bytes = new Uint8Array(head)
  if (bytes.length >= 4) {
    const magic =
      ((bytes[0] as number) << 24) |
      ((bytes[1] as number) << 16) |
      ((bytes[2] as number) << 8) |
      (bytes[3] as number)
    if (WAL_MAGIC.includes(magic >>> 0)) return 'wal'
  }
  if (/-wal$/i.test(name)) return 'wal'
  if (/-shm$/i.test(name)) return 'shm'
  return null
}

/** The database file that sits beside a `-wal` or `-shm`. */
function companionName(name: string): string {
  return name.replace(/-(wal|shm)$/i, '')
}

/** A blob, in the `X'hex'` form SQLite reads back as the same bytes. */
function blobLiteral(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return "X'" + hex + "'"
}

/**
 * One value as SQL text.
 *
 * Doubling an embedded quote is SQLite's only string escape, so a value
 * carrying `'); DROP TABLE t; --` survives as text rather than as syntax.
 * Infinity and NaN have no SQLite literal — `sqlite3` itself writes them as
 * NULL, and matching that keeps the dump replayable.
 */
function literal(value: SqlValue): string {
  if (value === null) return 'NULL'
  if (value instanceof Uint8Array) return blobLiteral(value)
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return String(value)
  return "'" + String(value).replace(/'/g, "''") + "'"
}

/** A double-quoted identifier, the form `sqlite3 .dump` emits. */
function identifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

/** Every row of one table, as INSERT statements. */
function insertsFor(db: Database, table: string): string[] {
  const statements: string[] = []
  const target = identifier(table)
  // Stepping a prepared statement holds one row at a time; `db.exec` would
  // materialise the whole table before a single line is written.
  const rows = db.prepare('SELECT * FROM ' + target)
  try {
    while (rows.step()) {
      const values = rows.get().map(literal).join(',')
      statements.push('INSERT INTO ' + target + ' VALUES(' + values + ');')
    }
  } finally {
    rows.free()
  }
  return statements
}

let runtime: Promise<initSqlJs.SqlJsStatic> | null = null

/** The WASM build, fetched once per tab and shared by every file after. */
function sqlRuntime(): Promise<initSqlJs.SqlJsStatic> {
  runtime ??= initSqlJs({ locateFile: (file) => '/' + file })
  return runtime
}

/**
 * Render a binary SQLite database as a `.dump` script.
 *
 * Objects come back in `sqlite_master` order, which is creation order, so a
 * table is always written before the indexes and triggers that reference it.
 * Tables are emitted with their rows; everything else follows, matching the
 * order `sqlite3 .dump` uses and restoring in the same order.
 */
export function dumpFromDatabase(db: Database): string {
  const lines = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;']
  const trailing: string[] = []

  // `sql` is NULL for auto-created indexes backing UNIQUE and PRIMARY KEY
  // constraints. Those come back with the CREATE TABLE that declared them,
  // and emitting them again would fail on restore.
  const objects = db.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
  )
  try {
    while (objects.step()) {
      const [type, name, sql] = objects.get() as [string, string, string]
      const statement = sql.trimEnd().replace(/;$/, '') + ';'
      if (type === 'table') {
        lines.push(statement, ...insertsFor(db, name))
      } else {
        trailing.push(statement)
      }
    }
  } finally {
    objects.free()
  }

  return [...lines, ...trailing, 'COMMIT;', ''].join('\n')
}

/** Open a binary SQLite database and render it as a `.dump` script. */
export async function sqliteFileToDump(buffer: ArrayBuffer): Promise<string> {
  const SQL = await sqlRuntime()
  const db = new SQL.Database(new Uint8Array(buffer))
  try {
    return dumpFromDatabase(db)
  } finally {
    db.close()
  }
}

/**
 * The dump text for a chosen file, whichever of the two forms it arrives in.
 *
 * A binary database is rendered into a dump; anything else is already text and
 * is read as-is. The WASM runtime is only fetched when a binary file actually
 * turns up, so the common case of opening a `.sql` file downloads nothing.
 */
export async function readDumpText(file: File): Promise<string> {
  const head = await file.slice(0, SQLITE_MAGIC_BYTES).arrayBuffer()

  // Named before anything is parsed: a companion file read as text produces a
  // meaningless "no tables found", which sends the user looking for a fault in
  // a database that is fine.
  const sidecar = sqliteSidecar(file.name, head)
  if (sidecar) {
    const database = companionName(file.name)
    throw new UnreadableFileError(
      sidecar === 'wal'
        ? `${file.name} is SQLite's write-ahead log, not a database. Choose ${database} instead — it holds the tables.`
        : `${file.name} is SQLite's shared-memory index, not a database. Choose ${database} instead — it holds the tables.`,
    )
  }

  if (file.size === 0) {
    throw new UnreadableFileError(`${file.name} is empty.`)
  }

  if (!isSqliteFile(head)) return file.text()
  return sqliteFileToDump(await file.arrayBuffer())
}
