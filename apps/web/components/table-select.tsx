'use client'

import { useRef } from 'react'
import { Table2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { PREVIEW_DRAG_TYPE } from '@/components/workspace'
import { createDragGhost } from '@/lib/drag-ghost'

interface TableSelectProps {
  tables: readonly { name: string }[]
  selectedTables: string[]
  allSelected: boolean
  someSelected: boolean
  rowCounts: Map<string, number>
  previewedTables: string[]
  onToggle: (tableName: string) => void
  onToggleAll: () => void
  onPreview: (tableName: string) => void
}

export function TableSelect({
  tables,
  selectedTables,
  allSelected,
  someSelected,
  rowCounts,
  previewedTables,
  onToggle,
  onToggleAll,
  onPreview,
}: TableSelectProps) {
  const ghostRef = useRef<HTMLElement | null>(null)

  const totalRows = tables.reduce(
    (sum, t) => sum + (rowCounts.get(t.name) ?? 0),
    0,
  )

  const removeGhost = () => {
    ghostRef.current?.remove()
    ghostRef.current = null
  }

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
            {selectedTables.length} / {tables.length}
          </span>
        </label>

        <div className="my-1 h-px bg-border" />

        <span className="px-1 text-xs text-muted-foreground">
          Drag a table into the workspace, or press Preview.
        </span>

        {tables.map((table) => {
          const rows = rowCounts.get(table.name) ?? 0
          const rowLabel = `${rows.toLocaleString()} row${rows === 1 ? '' : 's'}`
          const isPreviewed = previewedTables.includes(table.name)

          return (
            <div
              key={table.name}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(PREVIEW_DRAG_TYPE, table.name)
                event.dataTransfer.effectAllowed = 'copy'

                removeGhost()
                const ghost = createDragGhost(table.name, rowLabel)
                document.body.appendChild(ghost)
                ghostRef.current = ghost
                event.dataTransfer.setDragImage(ghost, 16, 16)
              }}
              onDragEnd={removeGhost}
              className={
                'group flex cursor-grab items-center gap-3 rounded-lg border px-3 py-2 transition-colors active:cursor-grabbing ' +
                (isPreviewed
                  ? 'border-input bg-accent/40'
                  : 'border-transparent hover:bg-accent/50')
              }
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <Checkbox
                  checked={selectedTables.includes(table.name)}
                  onCheckedChange={() => onToggle(table.name)}
                />
                <Table2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm">{table.name}</span>
              </label>

              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {rowLabel}
              </span>

              <button
                type="button"
                onClick={() => onPreview(table.name)}
                aria-label={`Preview ${table.name}`}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-[opacity,color,background-color] duration-200 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:opacity-0 lg:group-hover:opacity-100"
              >
                Preview
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
