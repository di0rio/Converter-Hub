import {
  FDB_HEADER_BYTES,
  groupSqliteFiles,
  isFdbFile,
  isSqliteFile,
  SQLITE_HEADER_BYTES,
  type SqliteFileGroup,
} from '@sql-extractor/core'

/**
 * The files a user picked, as one SQLite database.
 *
 * Grouping lives in the core, where the CLI shares it: pairing is by name, so
 * `orders.db` never takes `sessions.db-wal` as its log.
 */
export { groupSqliteFiles }

export type SqliteSelection = SqliteFileGroup<File>

/** The bytes of a selection, ready for the reader. */
export async function readSelection(
  selection: SqliteSelection,
): Promise<{ main: Uint8Array; wal?: Uint8Array | undefined }> {
  const main = new Uint8Array(await selection.main.arrayBuffer())
  // An empty log is what SQLite leaves behind after a checkpoint. Passing it on
  // is harmless, but leaving it out keeps the reader's own checks simpler.
  if (!selection.wal || selection.wal.size === 0) return { main }
  return { main, wal: new Uint8Array(await selection.wal.arrayBuffer()) }
}

/**
 * What the SQL tool accepts. A dump and a database both arrive under these
 * names, and the file's content - not the name - decides which one it is.
 */
export const SQL_TOOL_EXTENSIONS = [
  '.sql',
  '.txt',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.db3',
  '.fdb',
  '.gdb',
]

/**
 * Whether a selection is a database file - SQLite or Firebird - rather than
 * a dump.
 *
 * A `-wal` or `-shm` only ever sits beside a SQLite database, and a database
 * says what it is in its first bytes whatever it is called. Only that header
 * is read here.
 */
export async function isSqliteSelection(
  files: readonly File[],
): Promise<boolean> {
  if (files.some((file) => /-(wal|shm)$/i.test(file.name))) return true
  const [first] = files
  if (!first) return false
  const head = new Uint8Array(
    await first
      .slice(0, Math.max(SQLITE_HEADER_BYTES, FDB_HEADER_BYTES))
      .arrayBuffer(),
  )
  return isSqliteFile(head) || isFdbFile(head)
}
