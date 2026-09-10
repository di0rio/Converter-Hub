'use client'

import { useCallback, useMemo } from 'react'
import {
  AlertCircle,
  FileSpreadsheet,
  Scissors,
  Sheet,
  Table,
} from 'lucide-react'
import { formatBytes } from '@sql-extractor/core'
import { useWorkbook } from '@/hooks/use-workbook'
import { usePreviewWindows } from '@/hooks/use-preview-windows'
import { ACCEPTED_EXTENSIONS, type ExportFormat } from '@/lib/spreadsheet'
import { findTool } from '@/lib/tools'
import { FileSelect } from '@/components/file-select'
import { ToolHeader } from '@/components/tool-header'
import { FormatOptions } from '@/components/format-options'
import { DownloadStep } from '@/components/download-step'
import { Workspace } from '@/components/workspace'
import { SheetSelect } from '@/components/spreadsheet/sheet-select'
import { SheetViewer } from '@/components/spreadsheet/sheet-viewer'

const tool = findTool('spreadsheet')

const FORMATS = [
  {
    id: 'xlsx' as const,
    label: 'Excel',
    hint: 'One .xlsx per sheet',
    Icon: FileSpreadsheet,
  },
  { id: 'csv' as const, label: 'CSV', hint: 'One .csv per sheet', Icon: Table },
]

const ACCEPTED_SUMMARY = `Reads ${ACCEPTED_EXTENSIONS.join(', ')} workbooks.`

export function SheetSplitter() {
  const {
    loaded,
    sheets,
    exportable,
    loadStatus,
    selected,
    format,
    exportStatus,
    progress,
    result,
    error,
    allSelected,
    someSelected,
    loadFile,
    reportError,
    toggleSheet,
    toggleAll,
    selectFormat,
    separate,
    reset,
  } = useWorkbook()

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

  const hasSheets = loadStatus === 'ready' && sheets.length > 0

  // Only sheets with content can be opened: an empty one has nothing to show.
  const openable = useMemo(
    () => exportable.map((sheet) => sheet.name),
    [exportable],
  )

  const rowCounts = useMemo(
    () => new Map(sheets.map((sheet) => [sheet.name, sheet.rows])),
    [sheets],
  )

  const workbook = loaded?.workbook ?? null

  // The workspace holds names; turning one back into a sheet is this tool's
  // job, not the workspace's.
  const renderSheetPreview = useCallback(
    (name: string) =>
      workbook ? <SheetViewer workbook={workbook} name={name} /> : null,
    [workbook],
  )

  // Previews belong to the workbook they were opened from; loading another
  // closes them rather than leaving windows pointing at sheets that are gone.
  const handleFile = useCallback(
    (file: File) => {
      closeAllWindows()
      void loadFile(file)
    },
    [closeAllWindows, loadFile],
  )

  const handleReset = useCallback(() => {
    closeAllWindows()
    reset()
  }, [closeAllWindows, reset])

  const previewedSheets = windows.map((w) => w.name)

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
          id="workbook-input"
          label="Select a spreadsheet"
          buttonLabel="Choose spreadsheet"
          accept={ACCEPTED_EXTENSIONS}
          fileName={loaded?.fileName ?? null}
          reading={loadStatus === 'reading'}
          description={
            loaded
              ? `${sheets.length} sheet${sheets.length === 1 ? '' : 's'} found. Processed entirely in your browser.`
              : `${ACCEPTED_SUMMARY} Processed entirely in your browser.`
          }
          onFile={handleFile}
          onError={reportError}
        />

        {hasSheets && (
          <div className="motion-safe:animate-step-in">
            <SheetSelect
              sheets={sheets}
              exportableCount={exportable.length}
              selected={selected}
              allSelected={allSelected}
              someSelected={someSelected}
              previewed={previewedSheets}
              onToggle={toggleSheet}
              onToggleAll={toggleAll}
              onPreview={openWindow}
            />
          </div>
        )}

        {hasSheets && exportable.length > 0 && (
          <div className="space-y-8 motion-safe:animate-step-in">
            <FormatOptions<ExportFormat>
              id="step-format"
              label="Output format"
              options={FORMATS}
              value={format}
              onChange={selectFormat}
            />

            <DownloadStep
              id="step-download"
              label="Split and download"
              pending={`${selected.length} sheet${selected.length === 1 ? '' : 's'} ready to split.`}
              actionLabel="Split sheets"
              actionIcon={Scissors}
              busyLabel="Splitting..."
              busy={exportStatus === 'building'}
              progress={progress}
              result={result}
              facts={
                result
                  ? [
                      { label: 'Archive', value: result.filename },
                      { label: 'Files', value: String(result.files.length) },
                      {
                        label: 'Size',
                        value: formatBytes(result.bytes.byteLength),
                      },
                    ]
                  : []
              }
              onRun={separate}
              onReset={handleReset}
              onError={reportError}
            />
          </div>
        )}

        {hasSheets && exportable.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Every sheet in this file is empty, so there is nothing to split.
          </p>
        )}
      </div>
    </div>
  )

  return (
    // Two panes on desktop, stacked on narrow screens. The selection column is
    // a fixed track so opening a preview can never resize or reflow it — the
    // same shape the SQL tool uses.
    <div className="flex w-full flex-col gap-6 lg:min-h-0 lg:flex-1 lg:flex-row lg:gap-8">
      <div className="no-scrollbar flex shrink-0 justify-center lg:w-[34rem] lg:justify-start lg:overflow-y-auto lg:pr-2">
        {selectionPanel}
      </div>

      <div className="flex min-h-[24rem] min-w-0 flex-1 lg:min-h-0">
        <Workspace
          names={openable}
          ready={hasSheets}
          noun="sheet"
          emptyIcon={Sheet}
          renderPreview={renderSheetPreview}
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
