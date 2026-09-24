import {
  describeFbk,
  FDB_HEADER_BYTES,
  groupSqliteFiles,
  isFdbFile,
  isSqliteFile,
  SQLITE_HEADER_BYTES,
  type FbkDescription,
  type SqliteFileGroup,
} from '@sql-extractor/core'

export { groupSqliteFiles }

export type SqliteSelection = SqliteFileGroup<File>

export async function readSelection(
  selection: SqliteSelection,
): Promise<{ main: Uint8Array; wal?: Uint8Array | undefined }> {
  const main = new Uint8Array(await selection.main.arrayBuffer())
  if (!selection.wal || selection.wal.size === 0) return { main }
  return { main, wal: new Uint8Array(await selection.wal.arrayBuffer()) }
}

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

/**
 * Read a gbak backup's header, if that is what the file is.
 *
 * Only the opening bytes are read — the header record is the first thing in
 * the file — so this costs nothing on a file that turns out to be something
 * else, and never pulls a multi-gigabyte backup into memory.
 */
export async function describeBackup(
  file: File,
): Promise<FbkDescription | null> {
  try {
    const head = new Uint8Array(await file.slice(0, 512).arrayBuffer())
    return describeFbk(head)
  } catch {
    return null
  }
}
