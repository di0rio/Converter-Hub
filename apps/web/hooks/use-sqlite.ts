'use client'

import { useCallback, useMemo, useState } from 'react'
import { readSqliteDatabase, SqliteReadError } from '@sql-extractor/core'
import type {
  CsvDelimiter,
  SqliteDatabase,
  SqliteTable,
} from '@sql-extractor/core'
import { groupSqliteFiles, readSelection } from '@/lib/sqlite-files'
import { buildSqliteExport } from '@/lib/sqlite-export'
import type {
  SqliteExportFormat,
  SqliteExportResult,
} from '@/lib/sqlite-export'

export type SqliteStep = 'file' | 'tables' | 'export'
export type SqliteStatus = 'idle' | 'reading' | 'converting' | 'done'

/**
 * The largest database this tool will open.
 *
 * Everything is held in memory — the file, SQLite's page cache and the decoded
 * rows all at once — so the ceiling is the tab's, not the format's. Past this
 * the tab dies partway through with no message; refusing up front says so
 * instead. A database beyond it is a job for the CLI, which streams from disk.
 */
export const MAX_SQLITE_BYTES = 256 * 1024 * 1024

/**
 * Rows kept per table.
 *
 * A SQLite file gives no hint of its row count until it is open, and a small
 * file can hold millions of rows. This bounds what a single table can cost, and
 * the reader still reports the true count so a truncated read is never passed
 * off as a whole one.
 */
export const MAX_ROWS_PER_TABLE = 200_000

/** The generic message shown when nothing more specific is safe to say. */
const GENERIC =
  'This file could not be read as a SQLite database. It may be incomplete, damaged, or encrypted.'

function safeMessage(cause: unknown): string {
  // Only messages this project wrote are shown. Anything else may quote the
  // file's contents, and the user's data never goes on screen.
  return cause instanceof SqliteReadError ? cause.message : GENERIC
}

export function useSqlite() {
  const [database, setDatabase] = useState<SqliteDatabase | null>(null)
  const [fileName, setFileName] = useState('')
  const [walApplied, setWalApplied] = useState(false)
  const [truncated, setTruncated] = useState<string[]>([])
  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [exportFormat, setExportFormat] = useState<SqliteExportFormat>('csv')
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(',')
  const [status, setStatus] = useState<SqliteStatus>('idle')
  const [result, setResult] = useState<SqliteExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const step: SqliteStep = !database
    ? 'file'
    : selectedTables.length === 0
      ? 'tables'
      : 'export'

  const reset = useCallback(() => {
    setDatabase(null)
    setFileName('')
    setWalApplied(false)
    setTruncated([])
    setSelectedTables([])
    setDelimiter(',')
    setStatus('idle')
    setResult(null)
    setError(null)
  }, [])

  const reportError = useCallback((message: string) => {
    setError(message)
    setStatus('idle')
  }, [])

  const loadFiles = useCallback(
    async (files: File[]) => {
      setError(null)
      setResult(null)
      setStatus('reading')
      try {
        const selection = groupSqliteFiles(files)
        const total = selection.main.size + (selection.wal?.size ?? 0)
        if (total > MAX_SQLITE_BYTES) {
          throw new SqliteReadError(
            `This database is larger than ${Math.round(MAX_SQLITE_BYTES / 1024 / 1024)} MB, which is more than a browser tab can hold. Use the command line tool for a database this size.`,
          )
        }

        const bytes = await readSelection(selection)
        const read = await readSqliteDatabase(
          bytes,
          async () => {
            const response = await fetch('/wa-sqlite.wasm')
            if (!response.ok) {
              throw new SqliteReadError(
                'The SQLite engine could not be loaded. Reload the page and try again.',
              )
            }
            return response.arrayBuffer()
          },
          { rowLimit: MAX_ROWS_PER_TABLE },
        )

        setDatabase(read)
        setFileName(selection.main.name)
        setWalApplied(Boolean(bytes.wal))
        setTruncated(
          read.tables
            .filter((t) => t.rowCount > t.rows.length)
            .map((t) => t.name),
        )
        setSelectedTables([])
        setStatus('idle')
      } catch (cause) {
        setDatabase(null)
        setFileName('')
        reportError(safeMessage(cause))
      }
    },
    [reportError],
  )

  const tables = useMemo(() => database?.tables ?? [], [database])

  const toggleTable = useCallback((name: string) => {
    setSelectedTables((current) =>
      current.includes(name)
        ? current.filter((t) => t !== name)
        : [...current, name],
    )
  }, [])

  const toggleAllTables = useCallback(() => {
    setSelectedTables((current) =>
      current.length === tables.length ? [] : tables.map((t) => t.name),
    )
  }, [tables])

  const selectFormat = useCallback((format: SqliteExportFormat) => {
    setExportFormat(format)
    setResult(null)
  }, [])

  // An archive built with the previous delimiter no longer matches the choice.
  const selectDelimiter = useCallback((next: CsvDelimiter) => {
    setDelimiter(next)
    setResult(null)
  }, [])

  const convert = useCallback(() => {
    if (!database) return
    setStatus('converting')
    try {
      const chosen: SqliteTable[] = database.tables.filter((t) =>
        selectedTables.includes(t.name),
      )
      const base = fileName.replace(/\.[^.]+$/, '') || 'database'
      setResult(buildSqliteExport(base, chosen, exportFormat, { delimiter }))
      setStatus('done')
    } catch (cause) {
      reportError(safeMessage(cause))
    }
  }, [database, selectedTables, exportFormat, delimiter, fileName, reportError])

  return {
    database,
    tables,
    fileName,
    walApplied,
    truncated,
    selectedTables,
    exportFormat,
    delimiter,
    status,
    result,
    error,
    step,
    allTablesSelected:
      tables.length > 0 && selectedTables.length === tables.length,
    someTablesSelected:
      selectedTables.length > 0 && selectedTables.length < tables.length,
    loadFiles,
    toggleTable,
    toggleAllTables,
    selectFormat,
    selectDelimiter,
    convert,
    reset,
    reportError,
  }
}
