'use client'

import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, Minus, X } from 'lucide-react'
import type { Table } from '@sql-extractor/core'
import { TableViewer } from '@/components/table-viewer'
import { snapTarget, sameRect } from '@/lib/window-snap'
import type {
  Rect,
  PreviewWindow as PreviewWindowState,
  WorkspaceBounds,
} from '@/hooks/use-preview-windows'

interface PreviewWindowProps {
  window: PreviewWindowState
  table: Table
  rowCount: number
  /** True for the front-most window. */
  active: boolean
  /** The workspace size, which every snap zone is measured against. */
  bounds: WorkspaceBounds
  onFocus: () => void
  onClose: () => void
  onMinimize: () => void
  onMaximize: () => void
  onChange: (patch: Partial<Omit<PreviewWindowState, 'id' | 'tableName'>>) => void
  /** Report the region a release would snap to, so the workspace can draw it. */
  onSnapPreview: (rect: Rect | null) => void
}

/** Height of the window chrome, subtracted to size the scroll viewport. */
const HEADER_HEIGHT = 33
/**
 * Collapsed windows paint above every expanded one.
 *
 * A collapsed window is only a handle, and a handle that a maximised window can
 * bury is a table with no way back to it.
 */
const COLLAPSED_LAYER = 100_000
/** How long a maximise, restore or snap takes to settle. */
const SETTLE_MS = 260

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
  bounds,
  onFocus,
  onClose,
  onMinimize,
  onMaximize,
  onChange,
  onSnapPreview,
}: PreviewWindowProps) {
  const root = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  // The zone armed by the current drag. A ref as well as reported upward,
  // because the release handler needs it after the last move.
  const pendingSnap = useRef<Rect | null>(null)
  const [dragging, setDragging] = useState(false)
  // True only while a maximise, restore or snap plays out. Dragging and arrow
  // keys stay untransitioned: one has to track the pointer 1:1, the other is
  // repeated fast enough that any easing reads as lag.
  const [settling, setSettling] = useState(false)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  useEffect(
    () => () => {
      gesture.current = null
      if (settleTimer.current) clearTimeout(settleTimer.current)
    },
    [],
  )

  /** Ease the next geometry change instead of jumping to it. */
  function settle() {
    setSettling(true)
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(() => setSettling(false), SETTLE_MS)
  }

  /**
   * The pointer in workspace coordinates.
   *
   * The window's offset parent *is* the workspace, so the origin is read from
   * the live layout rather than passed down and kept in sync. Null in jsdom,
   * where there is no layout and snapping is simply off.
   */
  function workspacePoint(event: React.PointerEvent) {
    const parent = root.current?.offsetParent as HTMLElement | null
    if (!parent?.getBoundingClientRect) return null
    const rect = parent.getBoundingClientRect()
    if (!rect.width && !rect.height) return null
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

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
      const point = workspacePoint(event)
      const target = point ? snapTarget(point, bounds) : null
      if (!sameRect(target, pendingSnap.current)) {
        pendingSnap.current = target
        onSnapPreview(target)
      }
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
    const wasMoving = gesture.current?.kind === 'move'
    gesture.current = null
    setDragging(false)
    release(event.currentTarget, event.pointerId)

    const snap = pendingSnap.current
    pendingSnap.current = null
    if (!wasMoving || !snap) {
      if (snap) onSnapPreview(null)
      return
    }

    onSnapPreview(null)
    settle()
    // The pre-snap geometry becomes the restore target, so the same button that
    // un-maximises also undoes a snap.
    onChange({
      ...snap,
      restore: { x: win.x, y: win.y, width: win.width, height: win.height },
    })
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

  function maximize() {
    settle()
    onMaximize()
  }

  const maximized = win.restore !== null
  const height = win.minimized ? HEADER_HEIGHT : win.height
  const viewportHeight = Math.max(0, win.height - HEADER_HEIGHT)

  return (
    <div
      ref={root}
      role="dialog"
      aria-label={`${table.name} preview`}
      data-active={active ? '' : undefined}
      onPointerDown={onFocus}
      style={{
        left: win.x,
        top: win.y,
        width: win.width,
        height,
        zIndex: win.minimized ? COLLAPSED_LAYER + win.z : win.z,
      }}
      className={
        'absolute flex flex-col overflow-hidden rounded-xl border bg-card ' +
        'motion-safe:animate-preview-in ' +
        // Only shadow, border and depth react to focus: no size or position
        // change, so raising a window never shifts anything on screen.
        'transition-shadow duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ' +
        (settling
          ? 'motion-safe:transition-[left,top,width,height,box-shadow] ' +
            'motion-safe:duration-[260ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)] '
          : '') +
        (active
          ? 'border-input shadow-lg shadow-black/[0.13] ring-1 ring-black/[0.04] dark:ring-white/[0.06] '
          : 'border-border shadow-sm shadow-black/[0.06] ')
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
        onDoubleClick={maximize}
        className={
          'flex h-[33px] shrink-0 touch-none select-none items-center gap-2 ' +
          'border-b px-2.5 transition-colors duration-200 ' +
          'outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
          (win.minimized ? 'border-transparent ' : 'border-border ') +
          (active ? 'bg-muted/50 ' : 'bg-muted/25 ') +
          (dragging ? 'cursor-grabbing' : 'cursor-grab')
        }
      >
        <span
          className={
            'min-w-0 flex-1 truncate text-xs font-medium transition-colors duration-200 ' +
            (active ? 'text-foreground' : 'text-muted-foreground')
          }
        >
          {table.name}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {rowCount.toLocaleString()} row{rowCount === 1 ? '' : 's'}
        </span>

        <div className="-mr-1 flex shrink-0 items-center gap-px">
          <WindowButton
            label={
              win.minimized
                ? `Expand ${table.name} preview`
                : `Collapse ${table.name} preview`
            }
            onClick={onMinimize}
          >
            <Minus className="size-3.5" />
          </WindowButton>
          <WindowButton
            label={
              maximized
                ? `Restore ${table.name} preview`
                : `Maximize ${table.name} preview`
            }
            onClick={maximize}
          >
            {maximized ? (
              <Minimize2 className="size-3" />
            ) : (
              <Maximize2 className="size-3" />
            )}
          </WindowButton>
          <WindowButton
            label={`Close ${table.name} preview`}
            onClick={onClose}
            className="hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="size-3.5" />
          </WindowButton>
        </div>
      </header>

      {!win.minimized && (
        <>
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
            className="group absolute right-0 bottom-0 size-4 cursor-nwse-resize touch-none select-none"
          >
            {/* A hairline corner mark. The 16px parent is the real hit area. */}
            <div
              aria-hidden="true"
              className={
                'absolute right-1 bottom-1 size-2 rounded-br-[2px] border-r border-b ' +
                'transition-colors duration-150 group-hover:border-foreground ' +
                (active ? 'border-muted-foreground/60' : 'border-muted-foreground/30')
              }
            />
          </div>
        </>
      )}
    </div>
  )
}

/** A title-bar control: small target, instant press feedback, never a drag. */
function WindowButton({
  label,
  onClick,
  className = '',
  children,
}: {
  label: string
  onClick: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // The header owns pointer gestures; stop this one so pressing a control
      // never starts a drag.
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      aria-label={label}
      title={label}
      className={
        'rounded p-1 text-muted-foreground ' +
        'transition-[background-color,color,transform] duration-150 ' +
        'ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.9] ' +
        'hover:bg-accent hover:text-foreground ' +
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ' +
        className
      }
    >
      {children}
    </button>
  )
}
