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

const MAGIC = 'SQLite format 3\0'

export const SQLITE_HEADER_BYTES = MAGIC.length

export function isSqliteFile(head: Uint8Array): boolean {
  if (head.length < MAGIC.length) return false
  for (let i = 0; i < MAGIC.length; i++) {
    if (head[i] !== MAGIC.charCodeAt(i)) return false
  }
  return true
}

const WAL_MAGIC = new Set([0x377f0682, 0x377f0683])

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

// SQLite silently ignores a WAL whose header checksum is wrong, which would
// drop its rows. Check it the way wal.c does.
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

export interface SqliteFileSet {
  main: Uint8Array
  wal?: Uint8Array | undefined
}

export type WasmSupplier = () => Promise<Uint8Array | ArrayBuffer>

export interface ReadOptions {
  rowLimit?: number | undefined
}

interface Runtime {
  sqlite3: ReturnType<typeof SQLite.Factory>
  vfs: MemoryVFS
}

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
  // Without a -shm file SQLite only keeps the WAL index in memory under an
  // exclusive lock.
  await sqlite3.exec(db, 'PRAGMA locking_mode=EXCLUSIVE')
  // Stops the file's own views and triggers from calling functions with side
  // effects while it is read.
  await sqlite3.exec(db, 'PRAGMA trusted_schema=OFF')
  return { runtime: { sqlite3, vfs }, db }
}

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

function narrow(value: SqliteValue): SqliteValue {
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) &&
      value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value
  }
  return value
}

function identifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

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
    } catch {}
    runtime.vfs.mapNameToFile.clear()
  }
}
