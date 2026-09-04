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
  DatabaseFormat,
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
  /** The loaded file's text, kept so the source format can be changed. */
  const [sourceText, setSourceText] = useState<string | null>(null)
  /** An engine the user picked, overriding detection. */
  const [formatOverride, setFormatOverride] = useState<DatabaseFormat | null>(null)
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

  /**
   * Read the held text as `forced`, or as whatever detection names.
   *
   * Kept separate from `loadFile` so changing the source format re-reads the
   * file already in hand instead of asking the user to pick it again.
   */
  const read = useCallback(
    (content: string, name: string, forced: DatabaseFormat | null): boolean => {
      setSelectedDatabase('')
      clearSelection()
      setConfidence(null)

      if (content.trim().length === 0) {
        setDump(null)
        setError('That file is empty. Choose a database dump.')
        return false
      }

      // Detect once and hand the answer to the parser, so the UI can say
      // whether the engine was recognised or only assumed. An explicit choice
      // skips detection entirely.
      const detection = detectFormat(content)
      const format = forced ?? detection.format

      // The core refuses anything it cannot place, and names an engine it
      // recognises but cannot read. Both messages are safe to show as-is: they
      // carry no SQL, no paths and nothing about the parser.
      let parsed: SqlDump
      try {
        parsed = parseDump(content, { format: format ?? undefined })
      } catch (err) {
        setDump(null)
        setError(
          err instanceof UnsupportedFormatError
            ? err.message
            : 'That file could not be read as a database dump.',
        )
        return false
      }

      if (parsed.databases.length === 0) {
        setDump(null)
        setError('No databases or tables were found in this dump.')
        return false
      }

      setDump(parsed)
      setFileName(name)
      // An explicit choice is not a detection, and must not be reported as one.
      setConfidence(forced === null ? detection.confidence : null)
      setError(null)

      // A dump with exactly one database has nothing to choose between.
      if (parsed.databases.length === 1) {
        setSelectedDatabase(parsed.databases[0].name)
      }

      return true
    },
    [clearSelection],
  )

  const loadFile = useCallback(
    (content: string, name: string): boolean => {
      // Hold the text so the format can be changed without re-picking the file.
      setSourceText(content)
      setFileName(name)
      setFormatOverride(null)
      return read(content, name, null)
    },
    [read],
  )

  /** Re-read the loaded file as a named engine, or `null` to detect again. */
  const overrideSourceFormat = useCallback(
    (format: DatabaseFormat | null) => {
      setFormatOverride(format)
      if (sourceText !== null) read(sourceText, fileName, format)
    },
    [read, sourceText, fileName],
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
    setSourceText(null)
    setFormatOverride(null)
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
    formatOverride,
    loadFile,
    overrideSourceFormat,
    reportFileError,
    selectDatabase,
    toggleTable,
    toggleAllTables,
    selectFormat,
    convert,
    reset,
  }
}
