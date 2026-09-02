'use client'

import { useState, useCallback, useMemo } from 'react'
import { parseSqlDump, generateExport } from '@sql-extractor/core'
import type { SqlDump, ExportFormat, ExportResult } from '@sql-extractor/core'

export type Step = 'file' | 'database' | 'tables' | 'export'
export type ConversionStatus = 'idle' | 'converting' | 'done'

export function useSqlDump() {
  const [dump, setDump] = useState<SqlDump | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [selectedDatabase, setSelectedDatabase] = useState<string>('')
  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [previewTableName, setPreviewTableName] = useState<string>('')
  const [exportFormat, setExportFormat] = useState<ExportFormat>('sql')
  const [status, setStatus] = useState<ConversionStatus>('idle')
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const step: Step = !dump
    ? 'file'
    : !selectedDatabase
      ? 'database'
      : selectedTables.length === 0
        ? 'tables'
        : 'export'

  const database = useMemo(
    () => dump?.databases.find((d) => d.name === selectedDatabase) ?? null,
    [dump, selectedDatabase],
  )

  /** A previous archive no longer matches the current choices. */
  const clearResult = useCallback(() => {
    setResult(null)
    setStatus('idle')
  }, [])

  /** Drop the table selection as well as the archive built from it. */
  const clearSelection = useCallback(() => {
    setSelectedTables([])
    setPreviewTableName('')
    clearResult()
  }, [clearResult])

  const loadFile = useCallback(
    (content: string, name: string): boolean => {
      setSelectedDatabase('')
      clearSelection()

      if (content.trim().length === 0) {
        setDump(null)
        setFileName('')
        setError('That file is empty. Choose a MySQL or MariaDB dump.')
        return false
      }

      let parsed: SqlDump
      try {
        parsed = parseSqlDump(content)
      } catch {
        setDump(null)
        setFileName('')
        setError('Unable to read this file as a MySQL or MariaDB dump.')
        return false
      }

      if (parsed.databases.length === 0) {
        setDump(null)
        setFileName('')
        setError(
          'No databases or tables were found. This does not look like a MySQL or MariaDB dump.',
        )
        return false
      }

      setDump(parsed)
      setFileName(name)
      setError(null)

      // A dump with exactly one database has nothing to choose between.
      if (parsed.databases.length === 1) {
        setSelectedDatabase(parsed.databases[0].name)
      }

      return true
    },
    [clearSelection],
  )

  const reportFileError = useCallback((message: string) => {
    setError(message)
  }, [])

  const selectDatabase = useCallback(
    (name: string) => {
      setSelectedDatabase(name)
      clearSelection()
      setError(null)
    },
    [clearSelection],
  )

  const toggleTable = useCallback(
    (tableName: string) => {
      clearResult()
      setSelectedTables((prev) =>
        prev.includes(tableName)
          ? prev.filter((t) => t !== tableName)
          : [...prev, tableName],
      )
    },
    [clearResult],
  )

  const toggleAllTables = useCallback(() => {
    if (!database) return
    const all = database.tables.map((t) => t.name)
    clearResult()
    setSelectedTables((prev) => (prev.length === all.length ? [] : all))
  }, [database, clearResult])

  const selectFormat = useCallback(
    (format: ExportFormat) => {
      setExportFormat(format)
      setResult(null)
      setStatus('idle')
    },
    [],
  )

  const previewTable = useMemo(
    () => database?.tables.find((t) => t.name === previewTableName) ?? null,
    [database, previewTableName],
  )

  const previewTableName_ = previewTableName

  const allTablesSelected =
    database != null && selectedTables.length === database.tables.length
  const someTablesSelected =
    selectedTables.length > 0 && !allTablesSelected

  const convert = useCallback(() => {
    if (!dump || !selectedDatabase) return
    if (selectedTables.length === 0) {
      setError('Select at least one table to export.')
      return
    }

    setStatus('converting')
    setError(null)

    // Yield once so the converting state paints before a large dump blocks
    // the main thread.
    setTimeout(() => {
      try {
        const generated = generateExport(
          dump,
          { database: selectedDatabase, tables: selectedTables },
          exportFormat,
        )
        setResult(generated)
        setStatus('done')
      } catch {
        setResult(null)
        setStatus('idle')
        setError('Conversion failed. Try a different table selection or format.')
      }
    }, 0)
  }, [dump, selectedDatabase, selectedTables, exportFormat])

  const reset = useCallback(() => {
    setDump(null)
    setFileName('')
    setSelectedDatabase('')
    setExportFormat('sql')
    clearSelection()
    setError(null)
  }, [clearSelection])

  return {
    step,
    dump,
    fileName,
    selectedDatabase,
    selectedTables,
    exportFormat,
    database,
    previewTable,
    previewTableName: previewTableName_,
    status,
    result,
    error,
    allTablesSelected,
    someTablesSelected,
    loadFile,
    reportFileError,
    selectDatabase,
    toggleTable,
    toggleAllTables,
    setPreviewTableName,
    selectFormat,
    convert,
    reset,
  }
}
