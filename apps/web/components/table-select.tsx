'use client'

import { useRef } from 'react'
import { Table2 } from 'lucide-react'
import type { Database } from '@sql-extractor/core'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { TABLE_DRAG_TYPE } from '@/components/workspace'

interface TableSelectProps {
  database: Database
  selectedTables: string[]
  allSelected: boolean
  someSelected: boolean
  /** Row counts by table name, computed once by the parent. */
  rowCounts: Map<string, number>
  /** Tables that currently have a preview window open. */
  previewedTables: string[]
  onToggle: (tableName: string) => void
  onToggleAll: () => void
  /** Open a preview window for a table. Never changes the export selection. */
  onPreview: (tableName: string) => void
}

/**
 * Build the image the browser shows under the cursor while dragging.
 *
 * It must be in the document to be rasterised, but a plain `appendChild` puts a
 * block-level div in normal flow, where `width: auto` resolves to the full body
 * width — that is what made the drag image span the viewport. Taking it out of
 * flow and shrink-wrapping it keeps the snapshot the size of its own content.
 */
function createDragGhost(label: string, detail: string): HTMLElement {
  const ghost = document.createElement('div')

  const name = document.createElement('span')
  name.textContent = label
  const rows = document.createElement('span')
  rows.textContent = detail

  ghost.append(name, rows)
  ghost.style.cssText = [
    'position:fixed',
    'top:-1000px',
    'left:-1000px',
    'width:max-content',
    'max-width:16rem',
    'display:flex',
    'align-items:center',
    'gap:10px',
    'padding:6px 10px',
    'border-radius:8px',
    'border:1px solid var(--border)',
    'background:var(--popover)',
    'color:var(--popover-foreground)',
    'font-size:13px',
    'font-weight:500',
    'line-height:1.2',
    'white-space:nowrap',
    'box-shadow:0 8px 24px rgb(0 0 0 / 0.18)',
    'pointer-events:none',
  ].join(';')
  rows.style.cssText = 'opacity:.6;font-weight:400;font-variant-numeric:tabular-nums'

  return ghost
}

export function TableSelect({
  database,
  selectedTables,
  allSelected,
  someSelected,
  rowCounts,
  previewedTables,
  onToggle,
  onToggleAll,
  onPreview,
}: TableSelectProps) {
  // The live drag ghost, removed on dragend rather than on the next frame: a
  // rAF can run before the browser has taken its snapshot.
  const ghostRef = useRef<HTMLElement | null>(null)

  const totalRows = database.tables.reduce(
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
            {selectedTables.length} / {database.tables.length}
          </span>
        </label>

        <div className="my-1 h-px bg-border" />

        <span className="px-1 text-xs text-muted-foreground">
          Drag a table into the workspace, or press Preview.
        </span>

        {database.tables.map((table) => {
          const rows = rowCounts.get(table.name) ?? 0
          const rowLabel = `${rows.toLocaleString()} row${rows === 1 ? '' : 's'}`
          const isPreviewed = previewedTables.includes(table.name)

          return (
            <div
              key={table.name}
              draggable
              onDragStart={(event) => {
                // A private type, so only the workspace reacts and a drop onto
                // an unrelated text target does nothing.
                event.dataTransfer.setData(TABLE_DRAG_TYPE, table.name)
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

              {/* The non-drag path to a preview. Kept visible on focus so it is
                  reachable by keyboard, not only on hover. */}
              <button
                type="button"
                onClick={() => onPreview(table.name)}
                aria-label={`Preview ${table.name}`}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground opacity-0 transition-[opacity,color,background-color] duration-200 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
