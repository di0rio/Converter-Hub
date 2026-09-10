'use client'

import { useCallback, useMemo } from 'react'
import {
  AlertCircle,
  FileCode,
  FileSpreadsheet,
  Table,
  Table2,
  Wand2,
} from 'lucide-react'
import {
  SUPPORTED_FORMATS,
  countRows,
  isOversizedDump,
  oversizedDumpMessage,
} from '@sql-extractor/core'
import type {
  ExportFormat,
  FormatConfidence,
  FormatDescriptor,
} from '@sql-extractor/core'
import { useSqlDump } from '@/hooks/use-sql-dump'
import { usePreviewWindows } from '@/hooks/use-preview-windows'
import { findTool } from '@/lib/tools'
import { FileSelect } from '@/components/file-select'
import { ToolHeader } from '@/components/tool-header'
import { FormatCaveat } from '@/components/format-caveat'
import { DatabaseSelect } from '@/components/database-select'
import { TableSelect } from '@/components/table-select'
import { Workspace } from '@/components/workspace'
import { TableViewer } from '@/components/table-viewer'
import { FormatOptions } from '@/components/format-options'
import { DownloadStep } from '@/components/download-step'

const tool = findTool('sql')

const ACCEPTED_EXTENSIONS = ['.sql', '.txt']

const FORMATS = [
  { id: 'sql' as const, label: 'SQL', hint: 'One .sql dump', Icon: FileCode },
  { id: 'csv' as const, label: 'CSV', hint: 'One file per table', Icon: Table },
  {
    id: 'xlsx' as const,
    label: 'Excel',
    hint: 'One sheet per table',
    Icon: FileSpreadsheet,
  },
]

/**
 * Naming every supported engine turned into a wall of text as the list grew.
 * A count plus a few recognisable names says the same thing in one line.
 */
const HEADLINE_FORMATS = ['MySQL', 'PostgreSQL', 'SQL Server', 'SQLite']

const SUPPORTED_SUMMARY = (() => {
  const labels = SUPPORTED_FORMATS.map((format) => format.label)
  const headline = HEADLINE_FORMATS.filter((name) =>
    labels.some((label) => label.includes(name)),
  )

  return `Supports ${labels.length} dump formats, including ${headline.join(', ')}.`
})()

/**
 * Say what was actually established. A dump carrying an engine's own markers
 * is named; plain SQL that carries none is read as MySQL, and says so rather
 * than claiming a detection.
 */
function describeSource(
  sourceFormat: FormatDescriptor | null,
  confidence: FormatConfidence | null,
): string {
  if (!sourceFormat) return SUPPORTED_SUMMARY

  return confidence === 'assumed'
    ? `No engine markers found — read as ${sourceFormat.label}.`
    : `Read as a ${sourceFormat.label} dump.`
}

export function SqlExtractor() {
  const {
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
  } = useSqlDump()

  const {
    windows,
    mode,
    layout,
    openWindow,
    closeWindow,
    closeAllWindows,
    focusWindow,
    updateWindow,
    toggleMinimize,
    toggleMaximize,
    setMode,
    setLayout,
    setBounds,
  } = usePreviewWindows()

  const showDatabases =
    dump != null && sourceFormat != null && dump.databases.length > 0
  const databaseHasTables = database != null && database.tables.length > 0

  // Counting walks every INSERT, so do it once per database and share the
  // result with both the list and the windows.
  const rowCounts = useMemo(() => {
    const counts = new Map<string, number>()
    if (database) {
      for (const table of database.tables)
        counts.set(table.name, countRows(table))
    }
    return counts
  }, [database])

  // Previews belong to the database they were opened from; switching databases
  // closes them rather than leaving windows pointing at tables that are gone.
  const handleSelectDatabase = useCallback(
    (name: string) => {
      closeAllWindows()
      selectDatabase(name)
    },
    [closeAllWindows, selectDatabase],
  )

  const handleReset = useCallback(() => {
    closeAllWindows()
    reset()
  }, [closeAllWindows, reset])

  const handleFile = useCallback(
    (file: File) => {
      // Reject on the size the browser already knows, before reading. Past the
      // ceiling the tab runs out of memory partway through instead of saying so.
      if (isOversizedDump(file.size)) {
        reportFileError(oversizedDumpMessage(file.size))
        return
      }

      closeAllWindows()

      file
        .text()
        .then((content) => loadFile(content, file.name))
        .catch(() => {
          reportFileError(
            'That file could not be read. It may have been moved or renamed.',
          )
        })
    },
    [closeAllWindows, loadFile, reportFileError],
  )

  const previewedTables = windows.map((w) => w.name)

  const tableNames = useMemo(
    () => database?.tables.map((t) => t.name) ?? [],
    [database],
  )

  // The workspace holds names; turning one back into a table is this tool's
  // job, not the workspace's.
  const renderTablePreview = useCallback(
    (name: string) => {
      const table = database?.tables.find((t) => t.name === name)
      return table ? <TableViewer table={table} hideHeader bare /> : null
    },
    [database],
  )

  const selectionPanel = (
    <div className="w-full max-w-lg space-y-8">
      <ToolHeader tool={tool} />

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive-foreground motion-safe:animate-step-in"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-8">
        <FileSelect
          id="sql-file-input"
          label="Select a database dump"
          buttonLabel="Choose SQL file"
          accept={ACCEPTED_EXTENSIONS}
          fileName={fileName || null}
          description={`${describeSource(sourceFormat, confidence)} Processed entirely in your browser.`}
          onFile={handleFile}
          onError={reportFileError}
        />

        <FormatCaveat sourceFormat={sourceFormat} />

        {showDatabases && (
          <div className="motion-safe:animate-step-in">
            <DatabaseSelect
              databases={dump.databases}
              value={selectedDatabase}
              onChange={handleSelectDatabase}
              sourceFormat={sourceFormat}
            />
          </div>
        )}

        {database && databaseHasTables && (
          <div className="motion-safe:animate-step-in">
            <TableSelect
              database={database}
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

        {database && !databaseHasTables && sourceFormat && (
          <p className="text-sm text-muted-foreground">
            No tables were found in {database.name}. Pick another{' '}
            {sourceFormat.namespace}.
          </p>
        )}

        {step === 'export' && (
          <div className="space-y-8 motion-safe:animate-step-in">
            <FormatOptions<ExportFormat>
              id="step-format"
              label="Export format"
              options={FORMATS}
              value={exportFormat}
              onChange={selectFormat}
            />

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
              onError={reportFileError}
            />
          </div>
        )}
      </div>
    </div>
  )

  return (
    // Two panes on desktop, stacked on narrow screens. The selection column is
    // a fixed track so opening a preview can never resize or reflow it.
    <div className="flex w-full flex-col gap-6 lg:min-h-0 lg:flex-1 lg:flex-row lg:gap-8">
      <div className="no-scrollbar flex shrink-0 justify-center lg:w-[34rem] lg:justify-start lg:overflow-y-auto lg:pr-2">
        {selectionPanel}
      </div>

      <div className="flex min-h-[24rem] min-w-0 flex-1 lg:min-h-0">
        <Workspace
          names={tableNames}
          ready={database != null}
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
    </div>
  )
}
