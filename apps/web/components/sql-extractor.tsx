'use client'

import { useCallback, useMemo } from 'react'
import { countRows } from '@sql-extractor/core'
import { useSqlDump } from '@/hooks/use-sql-dump'
import { usePreviewWindows } from '@/hooks/use-preview-windows'
import { FileUpload } from '@/components/file-upload'
import { SourceFormatSelect } from '@/components/source-format-select'
import { DatabaseSelect } from '@/components/database-select'
import { TableSelect } from '@/components/table-select'
import { Workspace } from '@/components/workspace'
import { FormatSelect } from '@/components/format-select'
import { DownloadStep } from '@/components/download-step'
import { AlertCircle } from 'lucide-react'

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
    formatOverride,
    database,
    status,
    result,
    error,
    allTablesSelected,
    someTablesSelected,
    loadFile,
    overrideSourceFormat,
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
    openWindow,
    closeWindow,
    closeAllWindows,
    focusWindow,
    updateWindow,
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
      for (const table of database.tables) counts.set(table.name, countRows(table))
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

  const handleLoadFile = useCallback(
    (content: string, name: string) => {
      closeAllWindows()
      return loadFile(content, name)
    },
    [closeAllWindows, loadFile],
  )

  const previewedTables = windows.map((w) => w.tableName)

  const selectionPanel = (
    <div className="w-full max-w-lg space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          SQL Database Extractor
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Extract tables from a database dump, locally in your browser.
        </p>
      </header>

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
        <FileUpload
          onFile={handleLoadFile}
          onError={reportFileError}
          fileName={fileName || null}
          sourceFormat={sourceFormat}
          confidence={confidence}
        />

        {/* Only worth showing once there is a file to re-read. */}
        {fileName !== '' && (
          <SourceFormatSelect
            value={formatOverride}
            onChange={overrideSourceFormat}
          />
        )}

        {showDatabases && (
          <DatabaseSelect
            databases={dump.databases}
            value={selectedDatabase}
            onChange={handleSelectDatabase}
            sourceFormat={sourceFormat}
          />
        )}

        {database && databaseHasTables && (
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
        )}

        {database && !databaseHasTables && sourceFormat && (
          <p className="text-sm text-muted-foreground">
            No tables were found in {database.name}. Pick another{' '}
            {sourceFormat.namespace}.
          </p>
        )}

        {step === 'export' && (
          <>
            <FormatSelect value={exportFormat} onChange={selectFormat} />
            <DownloadStep
              status={status}
              result={result}
              tableCount={selectedTables.length}
              onConvert={convert}
              onReset={handleReset}
              onError={reportFileError}
            />
          </>
        )}
      </div>
    </div>
  )

  return (
    // Two panes on desktop, stacked on narrow screens. The selection column is
    // a fixed track so opening a preview can never resize or reflow it.
    <div className="flex h-full w-full flex-col gap-6 lg:flex-row lg:gap-8">
      <div className="no-scrollbar flex shrink-0 justify-center overflow-y-auto lg:w-[34rem] lg:justify-start lg:pr-2">
        {selectionPanel}
      </div>

      {databaseHasTables && (
        <div className="min-h-[24rem] min-w-0 flex-1 lg:h-full lg:min-h-0">
          <Workspace
            database={database}
            windows={windows}
            rowCounts={rowCounts}
            onOpen={openWindow}
            onClose={closeWindow}
            onFocus={focusWindow}
            onChange={updateWindow}
            onMeasure={setBounds}
          />
        </div>
      )}
    </div>
  )
}
