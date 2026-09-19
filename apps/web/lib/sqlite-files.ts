import {
  FDB_HEADER_BYTES,
  groupSqliteFiles,
  isFdbFile,
  isSqliteFile,
  SQLITE_HEADER_BYTES,
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
