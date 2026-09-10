'use client'

import { useCallback, useState } from 'react'
import { AlertCircle, FileSpreadsheet, Scissors, Table } from 'lucide-react'
import { formatBytes } from '@sql-extractor/core'
import { useWorkbook } from '@/hooks/use-workbook'
import { ACCEPTED_EXTENSIONS, type ExportFormat } from '@/lib/spreadsheet'
import { findTool } from '@/lib/tools'
import { FileDropzone } from '@/components/file-dropzone'
import { ToolHeader } from '@/components/tool-header'
import { FormatOptions } from '@/components/format-options'
import { DownloadStep } from '@/components/download-step'
import { SheetSelect } from '@/components/spreadsheet/sheet-select'
import { SheetPreview } from '@/components/spreadsheet/sheet-preview'

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

  const [opened, setOpened] = useState<string | null>(null)

  // Derived, not stored: the pane opens on the first sheet with content unless
  // one was picked, and a pick from a previous file is dropped rather than
  // pointing at a sheet the new workbook does not have.
  const previewed =
    opened && exportable.some((sheet) => sheet.name === opened)
      ? opened
      : (exportable[0]?.name ?? null)

  const handleReset = useCallback(() => {
    setOpened(null)
    reset()
  }, [reset])

  const handleFile = useCallback(
    (file: File) => {
      setOpened(null)
      void loadFile(file)
    },
    [loadFile],
  )

  const hasSheets = loadStatus === 'ready' && sheets.length > 0
  const previewedRows =
    sheets.find((sheet) => sheet.name === previewed)?.rows ?? 0

  const selectionPanel = (
    <div className="w-full max-w-lg space-y-8">
      <ToolHeader tool={tool} />

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive-foreground"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-8">
        <FileDropzone
          id="workbook-input"
          label="Select a spreadsheet"
          accept={ACCEPTED_EXTENSIONS}
          acceptHint={ACCEPTED_EXTENSIONS.join(' · ')}
          fileName={loaded?.fileName ?? null}
          detail={
            loaded
              ? `${sheets.length} sheet${sheets.length === 1 ? '' : 's'} found`
              : null
          }
          reading={loadStatus === 'reading'}
          description="The file is read in your browser. Nothing is uploaded."
          onFile={handleFile}
          onError={reportError}
        />

        {hasSheets && (
          <SheetSelect
            sheets={sheets}
            exportableCount={exportable.length}
            selected={selected}
            allSelected={allSelected}
            someSelected={someSelected}
            previewed={previewed}
            onToggle={toggleSheet}
            onToggleAll={toggleAll}
            onPreview={setOpened}
          />
        )}

        {hasSheets && exportable.length > 0 && (
          <>
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
          </>
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
    // a fixed track so the preview can never resize or reflow it — the same
    // shape the SQL tool uses.
    <div className="flex w-full flex-col gap-6 lg:h-full lg:flex-row lg:gap-8">
      <div className="no-scrollbar flex shrink-0 justify-center lg:w-[34rem] lg:justify-start lg:overflow-y-auto lg:pr-2">
        {selectionPanel}
      </div>

      <div className="min-h-[24rem] min-w-0 flex-1 lg:h-full lg:min-h-0">
        <SheetPreview
          workbook={loaded?.workbook ?? null}
          sheetName={previewed}
          totalRows={previewedRows}
        />
      </div>
    </div>
  )
}
