'use client'

import { useCallback, useEffect, useMemo } from 'react'
import {
  AlertCircle,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileText,
  Table,
  Table2,
  Wand2,
} from 'lucide-react'
import { sqliteToTabular } from '@sql-extractor/core'
import { useSqlite } from '@/hooks/use-sqlite'
import { usePreviewWindows } from '@/hooks/use-preview-windows'
import { findTool } from '@/lib/tools'
import { SQL_TOOL_EXTENSIONS } from '@/lib/sqlite-files'
import type { SqliteExportFormat } from '@/lib/sqlite-export'
import { FileSelect } from '@/components/file-select'
import { ToolHeader } from '@/components/tool-header'
import { TableSelect } from '@/components/table-select'
import { Workspace } from '@/components/workspace'
import { DataGrid } from '@/components/data-grid'
import { FormatOptions } from '@/components/format-options'
import { CsvDelimiterField } from '@/components/csv-delimiter-field'
import { DownloadStep } from '@/components/download-step'
import { Alert, AlertDescription } from '@/components/ui/alert'

const tool = findTool('sql')

const FORMATS = [
  { id: 'csv' as const, label: 'CSV', hint: 'One file per table', Icon: Table },
  {
    id: 'xlsx' as const,
    label: 'Excel',
    hint: 'One sheet per table',
    Icon: FileSpreadsheet,
  },
  { id: 'sql' as const, label: 'SQL', hint: 'Schema and rows', Icon: FileCode },
  {
    id: 'json' as const,
    label: 'JSON',
    hint: 'One file per table',
    Icon: FileJson,
  },
  {
    id: 'md' as const,
    label: 'Markdown',
    hint: 'One file per table',
    Icon: FileText,
  },
]

/** Rows a preview shows. Enough to judge the data, never the whole table. */
const PREVIEW_ROWS = 200

export function SqliteConverter({
  selection,
  onFiles,
}: {
  /** Files the SQL tool routed here as a database. Loaded when they change. */
  selection?: File[] | undefined
  /** Hands a new pick back to the SQL tool, which decides who reads it. */
  onFiles?: ((files: File[]) => void) | undefined
} = {}) {
  const {
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
    allTablesSelected,
    someTablesSelected,
    loadFiles,
    toggleTable,
    toggleAllTables,
    selectFormat,
    selectDelimiter,
    convert,
    reset,
    reportError,
  } = useSqlite()

  const {
    windows,
    mode,
    layout,
    openWindow,
    closeWindow,
    closeAllWindows,
    focusWindow,
    toggleMinimize,
    toggleMaximize,
    setMode,
    setLayout,
    updateWindow,
    setBounds,
  } = usePreviewWindows()

  const rowCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const table of tables) counts.set(table.name, table.rowCount)
    return counts
  }, [tables])

  const handleFiles = useCallback(
    (files: File[]) => {
      closeAllWindows()
      void loadFiles(files)
    },
    [closeAllWindows, loadFiles],
  )

  useEffect(() => {
    if (selection) handleFiles(selection)
  }, [selection, handleFiles])

  const handleReset = useCallback(() => {
    closeAllWindows()
    reset()
  }, [closeAllWindows, reset])

  const renderTablePreview = useCallback(
    (name: string) => {
      const table = tables.find((t) => t.name === name)
      if (!table) return null
      const tabular = sqliteToTabular(table)
      return (
        <DataGrid
          columns={tabular.columns}
          rows={tabular.rows.slice(0, PREVIEW_ROWS)}
          bare
          nullLabel="NULL"
        />
      )
    },
    [tables],
  )

  const previewedTables = windows.map((w) => w.name)

  const selectionPanel = (
    <div className="w-full max-w-lg space-y-8">
      <ToolHeader tool={tool} />

      {error && (
        <Alert variant="error" className="motion-safe:animate-step-in">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-8">
        <FileSelect
          id="sqlite-file-input"
          label="Select a SQL dump or SQLite database"
          buttonLabel="Choose file"
          accept={SQL_TOOL_EXTENSIONS}
          fileName={fileName || null}
          reading={status === 'reading'}
          multiple
          description="Select the database and, if it has them, its -wal and -shm files. Processed entirely in your browser."
          onFile={() => {}}
          onFiles={onFiles ?? handleFiles}
          onError={reportError}
        />

        {walApplied && (
          <Alert
            variant="info"
            role="status"
            className="motion-safe:animate-step-in"
          >
            <AlertDescription>
              A write-ahead log was included, so this shows the database&rsquo;s
              latest committed state.
            </AlertDescription>
          </Alert>
        )}

        {truncated.length > 0 && (
          <Alert
            variant="warning"
            role="status"
            className="motion-safe:animate-step-in"
          >
            <AlertDescription>
              Only the first rows were read from {truncated.join(', ')}. The row
              counts below are the true totals.
            </AlertDescription>
          </Alert>
        )}

        {tables.length > 0 && (
          <div className="motion-safe:animate-step-in">
            <TableSelect
              tables={tables}
              selectedTables={selectedTables}
              allSelected={allTablesSelected}
              someSelected={someTablesSelected}
              rowCounts={rowCounts}
              previewedTables={previewedTables}
              onToggle={toggleTable}
              onToggleAll={toggleAllTables}
              onPreview={openWindow}
            />
          </div>
        )}

        {step === 'export' && (
          <div className="space-y-8 motion-safe:animate-step-in">
            <div className="flex flex-col gap-4">
              <FormatOptions<SqliteExportFormat>
                id="step-format"
                label="Export format"
                options={FORMATS}
                value={exportFormat}
                onChange={selectFormat}
              />

              {exportFormat === 'csv' && (
                <CsvDelimiterField
                  value={delimiter}
                  onChange={selectDelimiter}
                />
              )}
            </div>

            <DownloadStep
              id="step-download"
              label="Convert and download"
              pending={`${selectedTables.length} table${selectedTables.length === 1 ? '' : 's'} ready to convert.`}
              actionLabel="Convert"
              actionIcon={Wand2}
              busyLabel="Converting..."
              busy={status === 'converting'}
              result={result}
              facts={
                result
                  ? [
                      { label: 'Archive', value: result.filename },
                      { label: 'Tables', value: String(result.tableCount) },
                      { label: 'Files', value: String(result.files.length) },
                    ]
                  : []
              }
              onRun={convert}
              onReset={handleReset}
              onError={reportError}
            />
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex w-full flex-col gap-6 lg:min-h-0 lg:flex-1 lg:flex-row lg:gap-8">
      <div className="no-scrollbar flex shrink-0 justify-center lg:w-[34rem] lg:justify-start lg:overflow-y-auto lg:pr-2">
        {selectionPanel}
      </div>
      <Workspace
        names={tables.map((t) => t.name)}
        ready={tables.length > 0}
        noun="table"
        emptyIcon={Table2}
        renderPreview={renderTablePreview}
        windows={windows}
        rowCounts={rowCounts}
        mode={mode}
        layout={layout}
        onOpen={openWindow}
        onClose={closeWindow}
        onCloseAll={closeAllWindows}
        onFocus={focusWindow}
        onMinimize={toggleMinimize}
        onMaximize={toggleMaximize}
        onModeChange={setMode}
        onLayoutChange={setLayout}
        onChange={updateWindow}
        onMeasure={setBounds}
      />
    </div>
  )
}
