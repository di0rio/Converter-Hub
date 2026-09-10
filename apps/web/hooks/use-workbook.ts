'use client'

import { useCallback, useMemo, useState } from 'react'
import type { CsvDelimiter } from '@sql-extractor/core'
import {
  buildArchive,
  isOversizedWorkbook,
  oversizedWorkbookMessage,
  readWorkbook,
  type ArchiveResult,
  type ExportFormat,
  type LoadedWorkbook,
  type SheetInfo,
} from '@/lib/spreadsheet'

export type LoadStatus = 'idle' | 'reading' | 'ready'
export type ExportStatus = 'idle' | 'building' | 'done'

/** How far the split has got, so the button can count rather than just spin. */
export interface Progress {
  done: number
  total: number
}

/**
 * The whole flow of the tool: read a file, choose sheets, write the archive.
 *
 * The parsed workbook is kept here rather than in the components so that
 * changing the export format never re-reads the file.
 */
export function useWorkbook() {
  const [loaded, setLoaded] = useState<LoadedWorkbook | null>(null)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle')
  const [selected, setSelected] = useState<string[]>([])
  const [format, setFormat] = useState<ExportFormat>('xlsx')
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(',')
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [result, setResult] = useState<ArchiveResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sheets: SheetInfo[] = useMemo(() => loaded?.sheets ?? [], [loaded])
  // Empty tabs are listed so the user can see they exist, but they are never
  // exported: a workbook of zero bytes helps nobody.
  const exportable = useMemo(() => sheets.filter((s) => !s.empty), [sheets])

  const reportError = useCallback((message: string) => {
    setError(message)
    setExportStatus('idle')
  }, [])

  const loadFile = useCallback(async (file: File) => {
    // Reject on the size the browser already knows, before reading. Past the
    // ceiling the tab runs out of memory partway through instead of saying so.
    if (isOversizedWorkbook(file.size)) {
      setError(oversizedWorkbookMessage(file.size))
      return
    }

    setError(null)
    setResult(null)
    setProgress(null)
    setExportStatus('idle')
    setLoadStatus('reading')

    try {
      const next = await readWorkbook(file)
      setLoaded(next)
      setSelected(next.sheets.filter((s) => !s.empty).map((s) => s.name))
      setLoadStatus('ready')

      if (next.sheets.length === 0) {
        setError('This file has no sheets in it.')
      }
    } catch {
      // The thrown error can carry fragments of the file, so it is never shown.
      setLoaded(null)
      setSelected([])
      setLoadStatus('idle')
      setError(
        'That file could not be read. Check that it is a valid .xlsx, .xlsm or .xls spreadsheet.',
      )
    }
  }, [])

  /** A previous archive no longer matches the current choices. */
  const clearResult = useCallback(() => {
    setResult(null)
    setProgress(null)
    setExportStatus('idle')
  }, [])

  const toggleSheet = useCallback(
    (name: string) => {
      clearResult()
      setSelected((prev) =>
        prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
      )
    },
    [clearResult],
  )

  const toggleAll = useCallback(() => {
    clearResult()
    setSelected((prev) =>
      prev.length === exportable.length ? [] : exportable.map((s) => s.name),
    )
  }, [clearResult, exportable])

  const selectFormat = useCallback(
    (next: ExportFormat) => {
      // The archive on screen was written in the previous format, so it is
      // dropped rather than left as a stale download.
      clearResult()
      setFormat(next)
    },
    [clearResult],
  )

  const selectDelimiter = useCallback(
    (next: CsvDelimiter) => {
      clearResult()
      setDelimiter(next)
    },
    [clearResult],
  )

  const separate = useCallback(async () => {
    if (!loaded || selected.length === 0) return

    // Keep the workbook's own tab order, not the click order.
    const ordered = loaded.sheets
      .filter((s) => selected.includes(s.name) && !s.empty)
      .map((s) => s.name)

    setError(null)
    setProgress({ done: 0, total: ordered.length })
    setExportStatus('building')

    try {
      const archive = await buildArchive(loaded, ordered, format, {
        delimiter,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      setResult(archive)
      setExportStatus('done')
    } catch {
      setExportStatus('idle')
      setProgress(null)
      reportError(
        'The archive could not be created. Try splitting fewer sheets at a time.',
      )
    }
  }, [loaded, selected, format, delimiter, reportError])

  const reset = useCallback(() => {
    setLoaded(null)
    setLoadStatus('idle')
    setSelected([])
    setFormat('xlsx')
    setDelimiter(',')
    setExportStatus('idle')
    setProgress(null)
    setResult(null)
    setError(null)
  }, [])

  return {
    loaded,
    sheets,
    exportable,
    loadStatus,
    selected,
    format,
    delimiter,
    exportStatus,
    progress,
    result,
    error,
    allSelected: exportable.length > 0 && selected.length === exportable.length,
    someSelected: selected.length > 0 && selected.length < exportable.length,
    loadFile,
    reportError,
    toggleSheet,
    toggleAll,
    selectFormat,
    selectDelimiter,
    separate,
    reset,
  }
}
