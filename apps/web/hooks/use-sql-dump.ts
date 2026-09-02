'use client'

import { useState, useCallback, useMemo } from 'react'
import {
  parseDump,
  generateExport,
  detectFormat,
  describeFormat,
  UnsupportedFormatError,
} from '@sql-extractor/core'
import type {
  SqlDump,
  ExportFormat,
  ExportResult,
  FormatConfidence,
  FormatDescriptor,
} from '@sql-extractor/core'

export type Step = 'file' | 'database' | 'tables' | 'export'
export type ConversionStatus = 'idle' | 'converting' | 'done'

export function useSqlDump() {
  const [dump, setDump] = useState<SqlDump | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [selectedDatabase, setSelectedDatabase] = useState<string>('')
  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [exportFormat, setExportFormat] = useState<ExportFormat>('sql')
  const [confidence, setConfidence] = useState<FormatConfidence | null>(null)
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

  /**
   * The engine the loaded dump was read as. Drives the words the UI uses:
   * PostgreSQL groups tables by schema, MySQL and MariaDB by database.
   */
  const sourceFormat: FormatDescriptor | null = useMemo(
    () => (dump ? describeFormat(dump.format) : null),
    [dump],
  )

  /** A previous archive no longer matches the current choices. */
  const clearResult = useCallback(() => {
    setResult(null)
    setStatus('idle')
  }, [])

  /** Drop the table selection as well as the archive built from it. */
  const clearSelection = useCallback(() => {
    setSelectedTables([])
    clearResult()
  }, [clearResult])

  const loadFile = useCallback(
    (content: string, name: string): boolean => {
      setSelectedDatabase('')
      clearSelection()

      setConfidence(null)

      if (content.trim().length === 0) {
        setDump(null)
        setFileName('')
        setError('That file is empty. Choose a database dump.')
        return false
      }

      // Detect once and hand the answer to the parser, so the UI can say
      // whether the engine was recognised or only assumed.
      const detection = detectFormat(content)

      // The core names the source engine from the dump's own markers and
      // refuses anything it cannot place. Its message is safe to show as-is:
      // it carries no SQL, no paths and nothing about the parser.
      let parsed: SqlDump
      try {
        parsed = parseDump(content, { format: detection.format ?? undefined })
      } catch (err) {
        setDump(null)
        setFileName('')
        setError(
          err instanceof UnsupportedFormatError
            ? 'Unsupported database format.'
            : 'That file could not be read as a database dump.',
        )
        return false
      }

      if (parsed.databases.length === 0) {
        setDump(null)
        setFileName('')
        setError('No databases or tables were found in this dump.')
        return false
      }

      setDump(parsed)
      setFileName(name)
      setConfidence(detection.confidence)
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
    setConfidence(null)
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
    sourceFormat,
    confidence,
    database,
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
    selectFormat,
    convert,
    reset,
  }
}
