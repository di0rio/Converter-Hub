'use client'

import { useEffect, useRef, useState } from 'react'
import { Table2 } from 'lucide-react'
import type { Database } from '@sql-extractor/core'
import { PreviewWindow } from '@/components/preview-window'
import {
  WINDOW_DEFAULT_WIDTH,
  type PreviewWindow as PreviewWindowState,
} from '@/hooks/use-preview-windows'

/** The drag payload a table row writes, so a stray text drop is ignored. */
export const TABLE_DRAG_TYPE = 'application/x-sql-table'

interface WorkspaceProps {
  database: Database | null
  windows: PreviewWindowState[]
  rowCounts: Map<string, number>
  onOpen: (tableName: string, at?: { x: number; y: number }) => void
  onClose: (id: string) => void
  onFocus: (id: string) => void
  onChange: (
    id: string,
    patch: Partial<Omit<PreviewWindowState, 'id' | 'tableName'>>,
  ) => void
  /** Report the measured workspace size, which clamps every window. */
  onMeasure: (bounds: { width: number; height: number }) => void
}

/**
 * The visualisation half of the app: an empty canvas that accepts dropped
 * tables and holds the open preview windows.
 *
 * It owns its own size (measured, not assumed) because every window position is
 * workspace-relative and has to be re-contained when the area changes.
 */
export function Workspace({
  database,
  windows,
  rowCounts,
  onOpen,
  onClose,
  onFocus,
  onChange,
  onMeasure,
}: WorkspaceProps) {
  const ref = useRef<HTMLDivElement>(null)
  // Counts nested dragenter/dragleave pairs; a plain boolean flickers off when
  // the pointer crosses a child element.
  const dragDepth = useRef(0)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const measure = () =>
      onMeasure({ width: el.clientWidth, height: el.clientHeight })

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [onMeasure])

  const accepts = (event: React.DragEvent) =>
    event.dataTransfer.types.includes(TABLE_DRAG_TYPE)

  const onDragEnter = (event: React.DragEvent) => {
    if (!accepts(event)) return
    dragDepth.current += 1
    setDragOver(true)
  }

  const onDragLeave = (event: React.DragEvent) => {
    if (!accepts(event)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }

  const onDragOver = (event: React.DragEvent) => {
    if (!accepts(event)) return
    // Only a prevented dragover marks this element as a drop target.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = (event: React.DragEvent) => {
    if (!accepts(event)) return
    event.preventDefault()
    dragDepth.current = 0
    setDragOver(false)

    const tableName = event.dataTransfer.getData(TABLE_DRAG_TYPE)
    if (!tableName) return

    const target = event.currentTarget
    // Re-measure before placing. The observer reports asynchronously, so a drop
    // that lands right after a layout change would otherwise be clamped against
    // a stale size and could sit slightly outside.
    onMeasure({ width: target.clientWidth, height: target.clientHeight })

    // Offsets are relative to the padding box, which is the containing block
    // for the absolutely positioned windows, so the border is subtracted out.
    const rect = target.getBoundingClientRect()
    const style = window.getComputedStyle(target)
    const originX = rect.left + parseFloat(style.borderLeftWidth)
    const originY = rect.top + parseFloat(style.borderTopWidth)

    // Drop where the pointer landed, biased so the window opens under the
    // cursor rather than hanging off it.
    onOpen(tableName, {
      x: event.clientX - originX - WINDOW_DEFAULT_WIDTH / 2,
      y: event.clientY - originY - 16,
    })
  }

  const tables = new Map(database?.tables.map((t) => [t.name, t]) ?? [])
  // A window whose table vanished (database switched) must not render.
  const open = windows.filter((w) => tables.has(w.tableName))

  return (
    <div
      ref={ref}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      aria-label="Preview workspace"
      className={
        'relative h-full w-full overflow-hidden rounded-xl border border-dashed ' +
        'transition-colors duration-200 ' +
        (dragOver ? 'border-ring bg-accent/40' : 'border-border bg-muted/20')
      }
    >
      {open.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <Table2
            className="size-5 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            {dragOver ? 'Drop to preview this table' : 'Drop a table here to preview it'}
          </p>
          {!dragOver && (
            <p className="text-xs text-muted-foreground/70">
              Drag one from the list, or press Preview on it.
            </p>
          )}
        </div>
      )}

      {open.map((w, index) => (
        <PreviewWindow
          key={w.id}
          window={w}
          table={tables.get(w.tableName)!}
          rowCount={rowCounts.get(w.tableName) ?? 0}
          active={index === open.length - 1}
          onFocus={() => onFocus(w.id)}
          onClose={() => onClose(w.id)}
          onChange={(patch) => onChange(w.id, patch)}
        />
      ))}
    </div>
  )
}
