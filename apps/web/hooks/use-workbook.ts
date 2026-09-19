'use client'

import { useCallback, useMemo, useState } from 'react'
import type { CsvDelimiter } from '@sql-extractor/core'
import { listExtensions } from '@/components/file-select'
import {
  ACCEPTED_EXTENSIONS,
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

export interface Progress {
  done: number
  total: number
}

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
  const exportable = useMemo(() => sheets.filter((s) => !s.empty), [sheets])

  const reportError = useCallback((message: string) => {
    setError(message)
    setExportStatus('idle')
  }, [])

  const loadFile = useCallback(async (file: File) => {
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
      setLoaded(null)
      setSelected([])
      setLoadStatus('idle')
      setError(
        `That file could not be read. Check that it is a valid ${listExtensions(ACCEPTED_EXTENSIONS)} file.`,
      )
    }
  }, [])

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
