import * as SQLite from 'wa-sqlite'
import { MemoryVFS } from 'wa-sqlite/src/examples/MemoryVFS.js'
import { SqliteReadError } from './index.js'
import type {
  SqliteColumn,
  SqliteDatabase,
  SqliteTable,
  SqliteValue,
  UnreadableTable,
} from './index.js'

/**
 * Reading a SQLite database, WAL included, without writing to the user's files.
 *
 * The database is handed to a real SQLite build compiled to WebAssembly, backed
 * by an in-memory filesystem holding the bytes the user selected. SQLite then
 * does what SQLite does: if a `-wal` sits beside the main file, its frames are
 * applied, so the reader sees the database's latest committed state rather than
 * whatever happened to be folded into the main file.
 *
 * The alternative - parsing the WAL by hand - was rejected: it risks reading a
 * partially-written frame as data and reporting a corrupt row as a real one.
 *
 * Nothing is written back. The files live in memory, the connection is opened
 * read-only, and the originals are never touched.
 */

/** The 16-byte header every SQLite database file opens with. */
const MAGIC = 'SQLite format 3\0'

/** Bytes needed to recognise a database. */
export const SQLITE_HEADER_BYTES = MAGIC.length

/**
 * Whether these bytes begin a SQLite database.
 *
 * Read from the header rather than the extension: SQLite mandates no extension,
 * files arrive as `.db`, `.sqlite`, `.sqlite3`, `.db3` and plenty of
 * application-specific names, and a text file renamed to `.db` is still text.
 */
export function isSqliteFile(head: Uint8Array): boolean {
  if (head.length < MAGIC.length) return false
  for (let i = 0; i < MAGIC.length; i++) {
    if (head[i] !== MAGIC.charCodeAt(i)) return false
  }
  return true
}

/** SQLite's write-ahead log header, in both byte orders the format allows. */
const WAL_MAGIC = new Set([0x377f0682, 0x377f0683])

/** Whether these bytes begin a SQLite write-ahead log. */
export function isWalFile(head: Uint8Array): boolean {
  if (head.length < 4) return false
  const magic =
    (((head[0] as number) << 24) |
      ((head[1] as number) << 16) |
      ((head[2] as number) << 8) |
      (head[3] as number)) >>>
    0
  return WAL_MAGIC.has(magic)
}

/**
 * Whether a write-ahead log's header is one SQLite will honour.
 *
 * SQLite treats a log whose header checksum does not match as empty and opens
 * the main file alone, without an error - which would export the database
 * minus its newest rows. So the header is verified first, the way SQLite's
 * wal.c does: two running sums over the first 24 bytes, read in the byte order
 * the magic number names, compared with the two stored big-endian after them.
 */
function isIntactWal(wal: Uint8Array): boolean {
  if (wal.length < 32 || !isWalFile(wal.subarray(0, 4))) return false
  const view = new DataView(wal.buffer, wal.byteOffset, 32)
  const littleEndian = (view.getUint32(0) & 1) === 0
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < 24; i += 8) {
    s1 = (s1 + view.getUint32(i, littleEndian) + s2) >>> 0
    s2 = (s2 + view.getUint32(i + 4, littleEndian) + s1) >>> 0
  }
  return s1 === view.getUint32(24) && s2 === view.getUint32(28)
}

export { SqliteReadError }

/** The bytes of one database, and of its write-ahead log when supplied. */
export interface SqliteFileSet {
  main: Uint8Array
  /** The `-wal` companion. Its rows are included when present. */
  wal?: Uint8Array | undefined
}

/**
 * Supplies the WebAssembly binary.
 *
 * The browser fetches it as a static asset and the CLI reads it from disk, so
 * the caller provides it rather than this module guessing at the host.
 */
export type WasmSupplier = () => Promise<Uint8Array | ArrayBuffer>

export interface ReadOptions {
  /** Rows to read per table. Omit for every row. */
  rowLimit?: number | undefined
}

interface Runtime {
  sqlite3: ReturnType<typeof SQLite.Factory>
  vfs: MemoryVFS
}

/** Names SQLite reserves for its own bookkeeping. */
function isInternalName(name: string): boolean {
  return /^sqlite_/i.test(name)
}

async function openRuntime(
  files: SqliteFileSet,
  wasm: WasmSupplier,
): Promise<{ runtime: Runtime; db: number }> {
  const factory = (await import('wa-sqlite/dist/wa-sqlite.mjs')).default
  const module = await factory({ wasmBinary: await wasm() })
  const sqlite3 = SQLite.Factory(module)
  const vfs = new MemoryVFS()
  // wa-sqlite ships its VFS examples as JavaScript, and their hand-written
  // declarations describe xRead's buffer differently from the interface the
  // registrar expects. The implementation is the one the library's own tests
  // run against; only the two declarations disagree.
  sqlite3.vfs_register(
    vfs as unknown as Parameters<typeof sqlite3.vfs_register>[0],
    false,
  )

  const put = (name: string, bytes: Uint8Array): void => {
    const data = new ArrayBuffer(bytes.length)
    new Uint8Array(data).set(bytes)
    vfs.mapNameToFile.set(name, { name, flags: 0, size: bytes.length, data })
  }
  put('db', files.main)
  if (files.wal) put('db-wal', files.wal)

  const db = await sqlite3.open_v2('db', SQLite.SQLITE_OPEN_READONLY, 'memory')
  // Without a -shm file SQLite keeps the WAL index in heap memory, which it
  // only does while holding an exclusive lock. The -shm carries no data of its
  // own, so nothing is lost by not having one.
  await sqlite3.exec(db, 'PRAGMA locking_mode=EXCLUSIVE')
  // Views and triggers in the file are the database's own code. Distrusting the
  // schema stops them calling functions with side effects while it is read.
  await sqlite3.exec(db, 'PRAGMA trusted_schema=OFF')
  return { runtime: { sqlite3, vfs }, db }
}

/** Every row a statement yields, as stored values. */
async function queryAll(
  sqlite3: Runtime['sqlite3'],
  db: number,
  sql: string,
  limit?: number,
): Promise<SqliteValue[][]> {
  const rows: SqliteValue[][] = []
  for await (const stmt of sqlite3.statements(db, sql)) {
    while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
      const row: SqliteValue[] = []
      for (let i = 0; i < sqlite3.column_count(stmt); i++) {
        const type = sqlite3.column_type(stmt, i)
        if (type === SQLite.SQLITE_NULL) row.push(null)
        else if (type === SQLite.SQLITE_BLOB) {
          // The view points into WASM memory and is reused by the next step.
          row.push(Uint8Array.from(sqlite3.column_blob(stmt, i)))
        } else if (type === SQLite.SQLITE_INTEGER) {
          row.push(sqlite3.column_int64(stmt, i) as unknown as bigint)
        } else if (type === SQLite.SQLITE_FLOAT) {
          row.push(sqlite3.column_double(stmt, i))
        } else row.push(sqlite3.column_text(stmt, i))
      }
      rows.push(row)
      if (limit !== undefined && rows.length >= limit) return rows
    }
  }
  return rows
}

/** A 64-bit integer narrowed to a number when that loses nothing. */
function narrow(value: SqliteValue): SqliteValue {
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) &&
      value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value
  }
  return value
}

/** A double-quoted identifier, safe to interpolate into a query. */
function identifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

/**
 * Read a SQLite database into the shape the writers take.
 *
 * Virtual tables are reported as unreadable rather than skipped silently: their
 * contents live in shadow tables an ordinary `SELECT` cannot reassemble, and
 * reading extensions is out of scope. Saying so is the difference between a
 * documented gap and quietly missing data.
 */
export async function readSqliteDatabase(
  files: SqliteFileSet,
  wasm: WasmSupplier,
  options: ReadOptions = {},
): Promise<SqliteDatabase> {
  if (!isSqliteFile(files.main.subarray(0, SQLITE_HEADER_BYTES))) {
    throw new SqliteReadError('This file is not a SQLite database.')
  }
  if (files.wal && files.wal.length > 0 && !isIntactWal(files.wal)) {
    throw new SqliteReadError(
      'The -wal file is damaged or is not a SQLite write-ahead log, so the database was not read.',
    )
  }

  let opened: { runtime: Runtime; db: number } | null = null
  try {
    opened = await openRuntime(files, wasm)
  } catch {
    throw new SqliteReadError(
      'This SQLite database could not be opened. It may be incomplete, or encrypted.',
    )
  }

  const { runtime, db } = opened
  const { sqlite3 } = runtime
  try {
    // A corrupt database is refused rather than half-read. This runs through
    // `exec` rather than the statement iterator on purpose: a malformed page
    // makes SQLite throw during prepare, and the iterator reports that as an
    // empty result, which would read a damaged database as one with no tables.
    let verdict = ''
    try {
      await sqlite3.exec(db, 'PRAGMA quick_check(1)', (row) => {
        verdict = String(row[0] ?? '')
      })
    } catch {
      throw new SqliteReadError(
        'This SQLite database failed its integrity check and was not read.',
      )
    }
    if (verdict !== 'ok') {
      throw new SqliteReadError(
        'This SQLite database failed its integrity check and was not read.',
      )
    }

    const schema = await queryAll(
      sqlite3,
      db,
      'SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL',
    )

    const unreadable: UnreadableTable[] = []
    const shadowOwners: string[] = []
    const tableRows = new Map<string, { create: string; indexes: string[] }>()

    for (const row of schema) {
      const type = String(row[0])
      const name = String(row[1])
      const owner = String(row[2])
      const sql = String(row[3])
      if (isInternalName(name)) continue

      if (type === 'table') {
        if (/^\s*CREATE\s+VIRTUAL\s+TABLE\b/i.test(sql)) {
          unreadable.push({ name, reason: 'virtual' })
          shadowOwners.push(name)
          continue
        }
        tableRows.set(name, { create: sql, indexes: [] })
      } else if (type === 'index') {
        tableRows.get(owner)?.indexes.push(sql)
      }
    }

    // A virtual table's shadow tables are real tables with a derived name.
    // Exporting them would leak an implementation detail as if it were data.
    for (const owner of shadowOwners) {
      for (const name of [...tableRows.keys()]) {
        if (name.startsWith(owner + '_')) tableRows.delete(name)
      }
    }

    const tables: SqliteTable[] = []
    for (const [name, meta] of tableRows) {
      const info = await queryAll(
        sqlite3,
        db,
        `PRAGMA table_info(${identifier(name)})`,
      )
      const columns: SqliteColumn[] = info.map((c) => ({
        name: String(c[1]),
        declaredType: String(c[2] ?? ''),
        notNull: Number(c[3]) === 1,
        primaryKey: Number(c[5]) > 0,
      }))
      if (columns.length === 0) continue

      const counted = await queryAll(
        sqlite3,
        db,
        `SELECT COUNT(*) FROM ${identifier(name)}`,
      )
      const rowCount = Number(narrow(counted[0]?.[0] ?? 0))

      // The columns are named rather than `*`: `table_info` leaves generated
      // columns out and `SELECT *` does not, so rows would stop lining up with
      // their header. A generated value is derived, and SQLite rebuilds it when
      // the SQL export is replayed.
      const list = columns.map((c) => identifier(c.name)).join(', ')
      const rows = (
        await queryAll(
          sqlite3,
          db,
          `SELECT ${list} FROM ${identifier(name)}`,
          options.rowLimit,
        )
      ).map((row) => row.map(narrow))

      tables.push({
        name,
        createStatement: meta.create,
        columns,
        rows,
        rowCount,
        indexStatements: meta.indexes,
      })
    }

    tables.sort((a, b) => a.name.localeCompare(b.name))
    return { tables, unreadable }
  } catch (cause) {
    if (cause instanceof SqliteReadError) throw cause
    throw new SqliteReadError(
      'This SQLite database could not be read. It may be incomplete or damaged.',
    )
  } finally {
    try {
      await sqlite3.close(db)
    } catch {
      // Closing a database that failed to open cleanly is not worth reporting.
    }
    runtime.vfs.mapNameToFile.clear()
  }
}
