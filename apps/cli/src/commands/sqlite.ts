import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import {
  createZip,
  formatBytes,
  groupSqliteFiles,
  readSqliteDatabase,
  sqliteToSql,
  sqliteToTabular,
  toCsv,
  toFileName,
  toXlsx,
  uniqueName,
  SqliteReadError,
} from '@sql-extractor/core'
import type { ExportFile, SqliteTable } from '@sql-extractor/core'

/**
 * Converting a SQLite database from the command line.
 *
 * The same reader the web app uses runs here, so a database converts to the same
 * bytes either way. What differs is where the files come from: the CLI has a
 * filesystem, so without an explicit `-wal` it reads the one beside the database
 * instead of waiting for someone to name it.
 *
 * Nothing is written back to the database. It is read into memory and opened
 * read-only.
 */

/** Four times the browser's ceiling: Node has room a tab does not. */
const MAX_SQLITE_FILE_BYTES = 1024 * 1024 * 1024

export type SqliteFormat = 'sql' | 'csv' | 'xlsx'

export interface SqliteOptions {
  format?: SqliteFormat
  output?: string
  tables?: string
}

const require = createRequire(import.meta.url)

/** wa-sqlite's WebAssembly binary, read from the installed package. */
async function wasm(): Promise<Uint8Array> {
  const dist = dirname(require.resolve('wa-sqlite/dist/wa-sqlite.mjs'))
  return readFile(join(dist, 'wa-sqlite.wasm'))
}

/** Only messages this project wrote are shown; others may quote the file. */
function safeMessage(cause: unknown, fallback: string): string {
  return cause instanceof SqliteReadError ? cause.message : fallback
}

/**
 * Convert the database among `paths`, with its `-wal` and `-shm` if given.
 *
 * Paths are paired by name, exactly as the browser pairs a selection, so a log
 * is only ever the one written beside its own database.
 */
export async function sqliteCommand(
  paths: string[],
  options: SqliteOptions,
): Promise<void> {
  if (paths.length === 0) throw new Error('Pass the path to a SQLite database.')

  let group
  try {
    group = groupSqliteFiles(paths.map((path) => ({ name: resolve(path) })))
  } catch (cause) {
    throw new Error(safeMessage(cause, 'Those files could not be read.'))
  }
  for (const file of [group.main, group.wal, group.shm]) {
    if (file && !existsSync(file.name)) {
      throw new Error('That file does not exist.')
    }
  }

  const path = group.main.name
  const walPath = group.wal?.name ?? `${path}-wal`
  // Checked before reading: the database and its log are read whole into
  // memory, and a file past the ceiling would end in an out-of-memory crash.
  const size =
    statSync(path).size + (existsSync(walPath) ? statSync(walPath).size : 0)
  if (size > MAX_SQLITE_FILE_BYTES) {
    throw new Error(
      `That database is ${formatBytes(size)}. The largest this tool opens is ${formatBytes(MAX_SQLITE_FILE_BYTES)}.`,
    )
  }
  const main = await readFile(path)
  // An empty log is what a checkpoint leaves behind; it carries nothing.
  const wal = existsSync(walPath) ? await readFile(walPath) : undefined

  let database
  try {
    database = await readSqliteDatabase(
      wal && wal.length > 0 ? { main, wal } : { main },
      wasm,
    )
  } catch (cause) {
    throw new Error(
      safeMessage(cause, 'This file could not be read as a SQLite database.'),
    )
  }

  const wanted = options.tables
    ?.split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  const chosen: SqliteTable[] =
    wanted && wanted.length > 0
      ? database.tables.filter((t) => wanted.includes(t.name))
      : database.tables

  if (chosen.length === 0) {
    throw new Error('No matching tables were found in this database.')
  }

  const format: SqliteFormat = options.format ?? 'csv'
  const stem = toFileName(basename(path).replace(/\.[^.]+$/, ''), 'database')
  const files: ExportFile[] = []
  const encoder = new TextEncoder()

  if (format === 'sql') {
    files.push({
      name: `${stem}.sql`,
      content: encoder.encode(sqliteToSql(chosen)),
    })
  } else if (format === 'xlsx') {
    files.push({
      name: `${stem}.xlsx`,
      content: toXlsx(chosen.map(sqliteToTabular)),
    })
  } else {
    // Table names become entry names, and two can collide once cleaned.
    const taken = new Set<string>()
    for (const table of chosen) {
      files.push({
        name: `${uniqueName(toFileName(table.name, 'table'), taken)}.csv`,
        content: encoder.encode(toCsv(sqliteToTabular(table))),
      })
    }
  }

  const target = resolve(options.output ?? `${stem}.zip`)
  await writeFile(target, createZip(files))

  const skipped = database.unreadable
  process.stdout.write(
    `Wrote ${files.length} file${files.length === 1 ? '' : 's'} from ` +
      `${chosen.length} table${chosen.length === 1 ? '' : 's'} to ${target}\n`,
  )
  if (skipped.length > 0) {
    process.stdout.write(
      `Skipped ${skipped.length} virtual table${skipped.length === 1 ? '' : 's'}: ` +
        `${skipped.map((t) => t.name).join(', ')}\n`,
    )
  }
}
