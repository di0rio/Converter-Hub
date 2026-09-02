'use client'

import { useSqlDump } from '@/hooks/use-sql-dump'
import { FileUpload } from '@/components/file-upload'
import { DatabaseSelect } from '@/components/database-select'
import { TableSelect } from '@/components/table-select'
import { DownloadStep } from '@/components/download-step'
import { AlertCircle } from 'lucide-react'

export function SqlExtractor() {
  const {
    step,
    dump,
    fileName,
    selectedDatabase,
    selectedTables,
    database,
    error,
    allTablesSelected,
    someTablesSelected,
    loadFile,
    selectDatabase,
    toggleTable,
    toggleAllTables,
    extract,
    reset,
  } = useSqlDump()

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
        <FileUpload onFile={loadFile} fileName={fileName || null} />

        {step !== 'file' && dump && (
          <DatabaseSelect
            databases={dump.databases}
            value={selectedDatabase}
            onChange={selectDatabase}
          />
        )}

        {step !== 'file' && step !== 'database' && database && (
          <TableSelect
            database={database}
            selectedTables={selectedTables}
            allSelected={allTablesSelected}
            someSelected={someTablesSelected}
            onToggle={toggleTable}
            onToggleAll={toggleAllTables}
          />
        )}

        {step === 'download' && (
          <DownloadStep extract={extract} onReset={reset} />
        )}
      </div>
    </div>
  )
}
