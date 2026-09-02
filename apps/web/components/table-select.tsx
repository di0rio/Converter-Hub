'use client'

import { Table2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { Database } from '@sql-extractor/core'

interface TableSelectProps {
  database: Database
  selectedTables: string[]
  allSelected: boolean
  someSelected: boolean
  onToggle: (tableName: string) => void
  onToggleAll: () => void
}

export function TableSelect({
  database,
  selectedTables,
  allSelected,
  someSelected,
  onToggle,
  onToggleAll,
}: TableSelectProps) {
  return (
    <section aria-labelledby="step-tables">
      <Label id="step-tables" className="mb-3 block text-base font-semibold sm:text-sm">
        Select tables
      </Label>

      <div className="flex flex-col gap-1">
        {/* Select all */}
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:bg-accent/50">
          <Checkbox
            checked={allSelected || someSelected}
            indeterminate={someSelected}
            onCheckedChange={onToggleAll}
          />
          <span className="text-sm font-medium">Select all</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {selectedTables.length} / {database.tables.length}
          </span>
        </label>

        <div className="my-1 h-px bg-border" />

        {/* Individual tables */}
        {database.tables.map((table) => (
          <label
            key={table.name}
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2 transition-colors hover:bg-accent/50"
          >
            <Checkbox
              checked={selectedTables.includes(table.name)}
              onCheckedChange={() => onToggle(table.name)}
            />
            <Table2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm">{table.name}</span>
          </label>
        ))}
      </div>
    </section>
  )
}
