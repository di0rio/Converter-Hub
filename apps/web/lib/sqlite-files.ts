import { groupSqliteFiles, type SqliteFileGroup } from '@sql-extractor/core'

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
