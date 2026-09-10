'use client'

import { useRef } from 'react'
import { Sheet } from 'lucide-react'
import type { SheetInfo } from '@/lib/spreadsheet'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { PREVIEW_DRAG_TYPE } from '@/components/workspace'
import { createDragGhost } from '@/lib/drag-ghost'

interface SheetSelectProps {
  sheets: SheetInfo[]
  exportableCount: number
  selected: string[]
  allSelected: boolean
  someSelected: boolean
  /** Sheets that currently have a preview open. */
  previewed: string[]
  onToggle: (name: string) => void
  onToggleAll: () => void
  onPreview: (name: string) => void
}

export function SheetSelect({
  sheets,
  exportableCount,
  selected,
  allSelected,
  someSelected,
  previewed,
  onToggle,
  onToggleAll,
  onPreview,
}: SheetSelectProps) {
  const totalRows = sheets.reduce((sum, sheet) => sum + sheet.rows, 0)

  // The live drag ghost, removed on dragend rather than on the next frame: a
  // rAF can run before the browser has taken its snapshot.
  const ghostRef = useRef<HTMLElement | null>(null)
  const removeGhost = () => {
    ghostRef.current?.remove()
    ghostRef.current = null
  }

  return (
    <section aria-labelledby="step-sheets">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <Label id="step-sheets" className="text-base font-semibold sm:text-sm">
          Select sheets
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
            {selected.length} / {exportableCount}
          </span>
        </label>

        <div className="my-1 h-px bg-border" />

        <span className="px-1 text-xs text-muted-foreground">
          Drag a sheet into the workspace, or press Preview.
        </span>

        {sheets.map((sheet) => {
          const isPreviewed = previewed.includes(sheet.name)
          const rowLabel = sheet.empty
            ? 'empty'
            : `${sheet.rows.toLocaleString()} row${sheet.rows === 1 ? '' : 's'}`

          return (
            <div
              key={sheet.name}
              draggable={!sheet.empty}
              onDragStart={(event) => {
                // A private type, so only the workspace reacts and a drop onto
                // an unrelated text target does nothing.
                event.dataTransfer.setData(PREVIEW_DRAG_TYPE, sheet.name)
                event.dataTransfer.effectAllowed = 'copy'

                removeGhost()
                const ghost = createDragGhost(sheet.name, rowLabel)
                document.body.appendChild(ghost)
                ghostRef.current = ghost
                event.dataTransfer.setDragImage(ghost, 16, 16)
              }}
              onDragEnd={removeGhost}
              className={
                'group flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ' +
                (sheet.empty ? '' : 'cursor-grab active:cursor-grabbing ') +
                (isPreviewed
                  ? 'border-input bg-accent/40'
                  : 'border-transparent hover:bg-accent/50')
              }
            >
              <label
                className={
                  'flex min-w-0 flex-1 items-center gap-3 ' +
                  (sheet.empty
                    ? 'cursor-not-allowed opacity-64'
                    : 'cursor-pointer')
                }
              >
                <Checkbox
                  checked={selected.includes(sheet.name)}
                  // An empty sheet would produce an empty file, so it is listed
                  // for transparency but cannot be exported.
                  disabled={sheet.empty}
                  onCheckedChange={() => onToggle(sheet.name)}
                />
                <Sheet className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm">{sheet.name}</span>
              </label>

              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {rowLabel}
              </span>

              {/* The same affordance the SQL tool uses. Always visible below
                  the desktop breakpoint, because a touch screen has no hover to
                  reveal it with. Kept visible on focus so it is reachable by
                  keyboard, not only by pointer. */}
              <button
                type="button"
                onClick={() => onPreview(sheet.name)}
                disabled={sheet.empty}
                aria-label={`Preview ${sheet.name}`}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-[opacity,color,background-color] duration-200 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:opacity-0 lg:group-hover:opacity-100 disabled:pointer-events-none disabled:text-muted-foreground/40"
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
