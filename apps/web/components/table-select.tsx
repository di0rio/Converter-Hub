'use client'

import { useMemo } from 'react'
import { Table2 } from 'lucide-react'
import { countRows } from '@sql-extractor/core'
import type { Database } from '@sql-extractor/core'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

interface TableSelectProps {
  database: Database
  selectedTables: string[]
  allSelected: boolean
  someSelected: boolean
  previewTableName: string
  onToggle: (tableName: string) => void
  onToggleAll: () => void
  onPreview: (tableName: string) => void
}

export function TableSelect({
  database,
  selectedTables,
  allSelected,
  someSelected,
  previewTableName,
  onToggle,
  onToggleAll,
  onPreview,
}: TableSelectProps) {
  // Counting walks every INSERT, so do it once per database, not per render.
  const rowCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const table of database.tables) counts.set(table.name, countRows(table))
    return counts
  }, [database])

  const totalRows = useMemo(
    () => database.tables.reduce((sum, t) => sum + (rowCounts.get(t.name) ?? 0), 0),
    [database, rowCounts],
  )

  return (
    <section aria-labelledby="step-tables">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <Label id="step-tables" className="text-base font-semibold sm:text-sm">
          Select tables
        </Label>
        <span className="text-xs text-muted-foreground tabular-nums">
          {totalRows.toLocaleString()} rows total
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:bg-accent/50">
          <Checkbox
            checked={allSelected || someSelected}
            indeterminate={someSelected}
            onCheckedChange={onToggleAll}
          />
          <span className="text-sm font-medium">Select all</span>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {selectedTables.length} / {database.tables.length}
          </span>
        </label>

        <div className="my-1 h-px bg-border" />

        {database.tables.map((table) => {
          const rows = rowCounts.get(table.name) ?? 0
          const isPreviewed = previewTableName === table.name

          return (
            <div
              key={table.name}
              className={
                'flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ' +
                (isPreviewed ? 'border-input bg-accent/40' : 'border-transparent hover:bg-accent/50')
              }
            >
              <label className="flex flex-1 cursor-pointer items-center gap-3">
                <Checkbox
                  checked={selectedTables.includes(table.name)}
                  onCheckedChange={() => onToggle(table.name)}
                />
                <Table2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-sm">{table.name}</span>
              </label>

              <button
                type="button"
                onClick={() => onPreview(table.name)}
                aria-pressed={isPreviewed}
                className="shrink-0 rounded px-1 text-xs text-muted-foreground tabular-nums transition-colors hover:text-foreground"
                title={'Preview ' + table.name}
              >
                {rows.toLocaleString()} row{rows === 1 ? '' : 's'}
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
