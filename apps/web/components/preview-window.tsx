'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Table } from '@sql-extractor/core'
import { TableViewer } from '@/components/table-viewer'
import type { PreviewWindow as PreviewWindowState } from '@/hooks/use-preview-windows'

interface PreviewWindowProps {
  window: PreviewWindowState
  table: Table
  rowCount: number
  /** True for the front-most window. */
  active: boolean
  onFocus: () => void
  onClose: () => void
  onChange: (patch: Partial<Omit<PreviewWindowState, 'id' | 'tableName'>>) => void
}

/** Height of the window chrome, subtracted to size the scroll viewport. */
const HEADER_HEIGHT = 33

type Gesture =
  | { kind: 'move'; grabX: number; grabY: number }
  | { kind: 'resize'; x0: number; y0: number; w: number; h: number }

/**
 * One floating table preview inside the workspace.
 *
 * Positioned absolutely against the workspace, never the viewport, so it cannot
 * drift over the selection panel or off the page. Gestures use native Pointer
 * Events with pointer capture — no drag-and-drop dependency is shipped.
 */
export function PreviewWindow({
  window: win,
  table,
  rowCount,
  active,
  onFocus,
  onClose,
  onChange,
}: PreviewWindowProps) {
  const gesture = useRef<Gesture | null>(null)
  const [dragging, setDragging] = useState(false)

  // Capture keeps the gesture alive when the pointer leaves the window, but it
  // is optional: it is absent in jsdom and throws when the id is not an active
  // pointer. The move/up handlers work either way, so a failure is ignored.
  const capture = (element: HTMLElement, pointerId: number) => {
    try {
      element.setPointerCapture?.(pointerId)
    } catch {
      // No active pointer with this id; the gesture still tracks without capture.
    }
  }
  const release = (element: HTMLElement, pointerId: number) => {
    try {
      if (element.hasPointerCapture?.(pointerId)) {
        element.releasePointerCapture(pointerId)
      }
    } catch {
      // Already released, or never captured.
    }
  }

  // A gesture in flight must not leave a stuck "dragging" state behind if the
  // window unmounts mid-drag (closed from elsewhere, database switched).
  useEffect(() => () => { gesture.current = null }, [])

  function startMove(event: React.PointerEvent<HTMLElement>) {
    // `button` is undefined under synthetic events in jsdom; only reject a real
    // non-primary button.
    if (event.button && event.button !== 0) return
    onFocus()
    gesture.current = {
      kind: 'move',
      grabX: event.clientX - win.x,
      grabY: event.clientY - win.y,
    }
    setDragging(true)
    capture(event.currentTarget, event.pointerId)
  }

  function startResize(event: React.PointerEvent<HTMLElement>) {
    if (event.button && event.button !== 0) return
    event.preventDefault()
    onFocus()
    gesture.current = {
      kind: 'resize',
      x0: event.clientX,
      y0: event.clientY,
      w: win.width,
      h: win.height,
    }
    capture(event.currentTarget, event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    const g = gesture.current
    if (!g) return

    if (g.kind === 'move') {
      // The grab offset is kept, so the window tracks the pointer 1:1 from
      // wherever it was picked up rather than snapping to a corner.
      onChange({ x: event.clientX - g.grabX, y: event.clientY - g.grabY })
      return
    }

    onChange({
      width: g.w + (event.clientX - g.x0),
      height: g.h + (event.clientY - g.y0),
    })
  }

  function endGesture(event: React.PointerEvent<HTMLElement>) {
    gesture.current = null
    setDragging(false)
    release(event.currentTarget, event.pointerId)
  }

  /** Nudge with the keyboard, so moving a window never requires a pointer. */
  function onHeaderKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const step = event.shiftKey ? 24 : 8
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const delta = moves[event.key]
    if (!delta) return
    event.preventDefault()
    onFocus()
    onChange({ x: win.x + delta[0], y: win.y + delta[1] })
  }

  const viewportHeight = Math.max(0, win.height - HEADER_HEIGHT)

  return (
    <div
      role="dialog"
      aria-label={`${table.name} preview`}
      onPointerDown={onFocus}
      style={{ left: win.x, top: win.y, width: win.width, height: win.height }}
      className={
        'absolute flex flex-col overflow-hidden rounded-lg border bg-card ' +
        'motion-safe:animate-preview-in ' +
        // Only the shadow and border react to focus: no size or position change,
        // so raising a window never shifts anything.
        (active
          ? 'border-input shadow-lg'
          : 'border-border shadow-sm')
      }
    >
      <header
        // A real gesture surface, not a control: the buttons inside it stay the
        // keyboard path, and the header itself is reachable for arrow-key moves.
        tabIndex={0}
        aria-label={`Move ${table.name} window`}
        onPointerDown={startMove}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onKeyDown={onHeaderKeyDown}
        className={
          'flex h-[33px] shrink-0 touch-none select-none items-center gap-2 ' +
          'border-b border-border bg-muted/40 px-2.5 ' +
          'outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
          (dragging ? 'cursor-grabbing' : 'cursor-grab')
        }
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {table.name}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {rowCount.toLocaleString()} row{rowCount === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={onClose}
          // The header owns pointer gestures; stop this one so pressing close
          // never starts a drag.
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={`Close ${table.name} preview`}
          className="-mr-1 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <X className="size-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <TableViewer table={table} hideHeader height={viewportHeight} bare />
      </div>

      <div
        role="separator"
        aria-label={`Resize ${table.name} preview`}
        onPointerDown={startResize}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        className="absolute right-0 bottom-0 size-4 cursor-nwse-resize touch-none select-none"
      >
        {/* A hairline corner mark. The 16px parent is the real hit area. */}
        <div
          aria-hidden="true"
          className="absolute right-1 bottom-1 size-2 border-r border-b border-muted-foreground/50"
        />
      </div>
    </div>
  )
}
