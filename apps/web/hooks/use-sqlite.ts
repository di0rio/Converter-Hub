'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  BAK_HEADER_BYTES,
  isBakFile,
  isFbkFile,
  isFdbFile,
  readDbfDatabase,
  readFbkDatabase,
  readFdbDatabase,
  readMssqlBackupBlob,
  readSqliteDatabase,
  SqliteReadError,
} from '@sql-extractor/core'
import type {
  CsvDelimiter,
  SqliteDatabase,
  SqliteTable,
} from '@sql-extractor/core'
import {
  dbfSelectionBytes,
  groupSqliteFiles,
  isDbfSelection,
  readDbfSelection,
  readSelection,
} from '@/lib/sqlite-files'
import { buildSqliteExport } from '@/lib/sqlite-export'
import type {
  SqliteExportFormat,
  SqliteExportResult,
} from '@/lib/sqlite-export'

export type SqliteStep = 'file' | 'tables' | 'export'
export type SqliteStatus = 'idle' | 'reading' | 'converting' | 'done'

export const MAX_SQLITE_BYTES = 256 * 1024 * 1024

/**
 * A SQL Server backup is streamed from the file and only its data pages are
 * kept, so the file can be far larger than a database that has to be read
 * whole. What bounds it is the table data inside, which is held to its own
 * limit and refused with a message past it.
 */
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024 * 1024
export const MAX_BACKUP_DATA_BYTES = 512 * 1024 * 1024

export const MAX_ROWS_PER_TABLE = 200_000

const GENERIC =
  'This file could not be read as a SQLite database. It may be incomplete, damaged, or encrypted.'

function tooLarge(ceiling: number): SqliteReadError {
  return new SqliteReadError(
    `This database is larger than ${Math.round(ceiling / 1024 / 1024)} MB, which is more than a browser tab can hold. Use the command line tool for a database this size.`,
  )
}

function safeMessage(cause: unknown): string {
  return cause instanceof SqliteReadError ? cause.message : GENERIC
}

async function readDatabase(bytes: {
  main: Uint8Array
  wal?: Uint8Array | undefined
}): Promise<SqliteDatabase> {
  if (isFdbFile(bytes.main)) {
    return readFdbDatabase(bytes.main, { rowLimit: MAX_ROWS_PER_TABLE })
  }
  if (isFbkFile(bytes.main)) {
    return readFbkDatabase(bytes.main, { rowLimit: MAX_ROWS_PER_TABLE })
  }
  return readSqliteDatabase(
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
}

export function useSqlite() {
  const [database, setDatabase] = useState<SqliteDatabase | null>(null)
  const [fileName, setFileName] = useState('')
  /** Set when the export cannot be named after a single selected file. */
  const [exportBase, setExportBase] = useState('')
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
    setExportBase('')
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
        // A dBase selection is one table per file, so it is grouped and read
        // on its own rather than as a main database with companion files.
        if (await isDbfSelection(files)) {
          const size = dbfSelectionBytes(files)
          if (size > MAX_SQLITE_BYTES) throw tooLarge(MAX_SQLITE_BYTES)
          const sources = await readDbfSelection(files)
          const read = readDbfDatabase(sources, {
            rowLimit: MAX_ROWS_PER_TABLE,
          })
          const only = sources.length === 1 ? sources[0] : undefined
          setDatabase(read)
          setFileName(only ? only.name : `${sources.length} dBase tables`)
          setExportBase(only ? '' : 'dbase-tables')
          setWalApplied(false)
          setTruncated(
            read.tables
              .filter((t) => t.rowCount > t.rows.length)
              .map((t) => t.name),
          )
          setSelectedTables([])
          setStatus('idle')
          return
        }

        const selection = groupSqliteFiles(files)
        const head = new Uint8Array(
          await selection.main.slice(0, BAK_HEADER_BYTES).arrayBuffer(),
        )
        const backup = isBakFile(head)
        const ceiling = backup ? MAX_BACKUP_BYTES : MAX_SQLITE_BYTES
        const total = selection.main.size + (selection.wal?.size ?? 0)
        if (total > ceiling) throw tooLarge(ceiling)

        // A backup is streamed from the file; everything else is read whole.
        const bytes = backup ? null : await readSelection(selection)
        const read = bytes
          ? await readDatabase(bytes)
          : await readMssqlBackupBlob(selection.main, {
              rowLimit: MAX_ROWS_PER_TABLE,
              maxDataBytes: MAX_BACKUP_DATA_BYTES,
            })

        setDatabase(read)
        setFileName(selection.main.name)
        setExportBase('')
        setWalApplied(Boolean(bytes?.wal))
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
        setExportBase('')
        reportError(safeMessage(cause))
      }
    },
    [reportError],
  )

  const tables = useMemo(() => database?.tables ?? [], [database])
  const unreadable = useMemo(() => database?.unreadable ?? [], [database])

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
      const base = exportBase || fileName.replace(/\.[^.]+$/, '') || 'database'
      setResult(buildSqliteExport(base, chosen, exportFormat, { delimiter }))
      setStatus('done')
    } catch (cause) {
      reportError(safeMessage(cause))
    }
  }, [
    database,
    selectedTables,
    exportFormat,
    delimiter,
    exportBase,
    fileName,
    reportError,
  ])

  return {
    database,
    tables,
    unreadable,
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
