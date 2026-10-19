import {
  BAK_HEADER_BYTES,
  DBF_HEADER_BYTES,
  FBK_HEADER_BYTES,
  FDB_HEADER_BYTES,
  groupDbfFiles,
  groupSqliteFiles,
  isBakFile,
  isDbfFile,
  isFbkFile,
  isFdbFile,
  isSqliteFile,
  SQLITE_HEADER_BYTES,
  type DbfSource,
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
  '.fbk',
  '.gbk',
  '.bak',
  '.jnmbak',
  '.dbf',
  '.dbt',
  '.fpt',
]

/** The table and memo files a dBase or FoxPro selection is made of. */
const DBF_EXTENSION = /\.(dbf|dbt|fpt)$/i

export function hasDbfExtension(files: readonly File[]): boolean {
  return files.some((file) => DBF_EXTENSION.test(file.name))
}

export async function isDbfSelection(files: readonly File[]): Promise<boolean> {
  if (hasDbfExtension(files)) return true
  const [first] = files
  if (!first) return false
  const head = new Uint8Array(
    await first.slice(0, DBF_HEADER_BYTES).arrayBuffer(),
  )
  return isDbfFile(head)
}

/** Reads each selected table together with the memo file that belongs to it. */
export async function readDbfSelection(
  files: readonly File[],
): Promise<DbfSource[]> {
  const groups = groupDbfFiles([...files])
  return Promise.all(
    groups.map(async ({ table, memo }) => ({
      name: table.name,
      bytes: new Uint8Array(await table.arrayBuffer()),
      memo: memo ? new Uint8Array(await memo.arrayBuffer()) : undefined,
    })),
  )
}

export function dbfSelectionBytes(files: readonly File[]): number {
  return files
    .filter((file) => DBF_EXTENSION.test(file.name))
    .reduce((total, file) => total + file.size, 0)
}

export async function isSqliteSelection(
  files: readonly File[],
): Promise<boolean> {
  if (files.some((file) => /-(wal|shm)$/i.test(file.name))) return true
  if (hasDbfExtension(files)) return true
  const [first] = files
  if (!first) return false
  const head = new Uint8Array(
    await first
      .slice(
        0,
        Math.max(
          SQLITE_HEADER_BYTES,
          FDB_HEADER_BYTES,
          FBK_HEADER_BYTES,
          BAK_HEADER_BYTES,
          DBF_HEADER_BYTES,
        ),
      )
      .arrayBuffer(),
  )
  return (
    isSqliteFile(head) ||
    isFdbFile(head) ||
    isFbkFile(head) ||
    isBakFile(head) ||
    isDbfFile(head)
  )
}
