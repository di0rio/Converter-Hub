'use client'

import { useSqlDump } from '@/hooks/use-sql-dump'
import { FileUpload } from '@/components/file-upload'
import { DatabaseSelect } from '@/components/database-select'
import { TableSelect } from '@/components/table-select'
import { FloatingPreview } from '@/components/floating-preview'
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
    database,
    previewTable,
    previewTableName,
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
  } = useSqlDump()

  const showDatabases = dump != null && dump.databases.length > 0
  const databaseHasTables = database != null && database.tables.length > 0

  return (
    <div className="w-full max-w-lg space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          SQL Database Extractor
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Extract databases and tables from MySQL dumps locally.
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
          onFile={loadFile}
          onError={reportFileError}
          fileName={fileName || null}
        />

        {showDatabases && (
          <DatabaseSelect
            databases={dump.databases}
            value={selectedDatabase}
            onChange={selectDatabase}
          />
        )}

        {database && databaseHasTables && (
          <TableSelect
            database={database}
            selectedTables={selectedTables}
            allSelected={allTablesSelected}
            someSelected={someTablesSelected}
            previewTableName={previewTableName}
            onToggle={toggleTable}
            onToggleAll={toggleAllTables}
          />
        )}

        {database && databaseHasTables && (
          <FloatingPreview table={previewTable} onPreview={setPreviewTableName} />
        )}

        {database && !databaseHasTables && (
          <p className="text-sm text-muted-foreground">
            No tables were found in {database.name}. Pick another database.
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
              onReset={reset}
              onError={reportFileError}
            />
          </>
        )}
      </div>
    </div>
  )
}
