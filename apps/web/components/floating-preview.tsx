'use client'

import { useEffect, useRef, useState } from 'react'
import { GripVertical, Maximize2, Minimize2, Table2, X } from 'lucide-react'
import { toTabular } from '@sql-extractor/core'
import type { Table } from '@sql-extractor/core'
import { TableViewer } from '@/components/table-viewer'

const MIN_WIDTH = 260
const MIN_HEIGHT = 180
const DEFAULT_WIDTH = 416 // matches the min(92vw, 26rem) default

interface FloatingPreviewProps {
  /** The table to preview, or null when none is selected. */
  table: Table | null
  /** Called when a table is dropped onto the floating window. */
  onPreview: (tableName: string) => void
}

interface Point {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

type ResizeDir = 'e' | 's' | 'se'

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

// The live viewport. Prefers the visual viewport so the window stays on the visible
// screen even when the browser window itself spans multiple monitors.
const viewport = () => {
  if (typeof window === 'undefined') return { width: 1024, height: 768 }
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  }
}

/**
 * A floating preview window with browser-like window behavior: drag it by the header,
 * resize it in any direction, drop a table onto it, and double-click (or use the button)
 * to maximize and restore it. Native Pointer Events power the gestures (pointer capture +
 * touch-action none) so no drag-and-drop dependency is shipped.
 */
export function FloatingPreview({ table, onPreview }: FloatingPreviewProps) {
  const [open, setOpen] = useState(true)
  const [maximized, setMaximized] = useState(false)
  const [position, setPosition] = useState<Point | null>(null)
  const [dragOver, setDragOver] = useState(false)
  // Explicit user size; null keeps the window content-sized.
  const [size, setSize] = useState<Size | null>(null)
  const [bodyHeight, setBodyHeight] = useState(320)
  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // Pointer-offset of the grab relative to the panel's top-left at drag start.
  const dragOffset = useRef<Point | null>(null)
  // Start values captured when a resize begins so the new size derives from them.
  const resizeStart = useRef<{ x0: number; y0: number; w: number; h: number; dir: ResizeDir; pos: Point } | null>(null)

  // Pointer capture is not available in every environment (e.g. jsdom); guard it so the
  // gestures still work via move/up listeners and never throw.
  const capturePointer = (element: HTMLElement, pointerId: number) => {
    if (typeof element.setPointerCapture === 'function') element.setPointerCapture(pointerId)
  }
  const releasePointer = (element: HTMLElement, pointerId: number) => {
    if (typeof element.hasPointerCapture === 'function' && element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId)
    }
  }

  // Feed the measured body height to TableViewer so its virtualized viewport tracks the
  // resized/maximized window height instead of a fixed 320.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const el = bodyRef.current
    if (!el) return
    const update = () => setBodyHeight(el.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  function onHeaderPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // button may be undefined in environments without a real pointer event (e.g. jsdom).
    if ((event.button && event.button !== 0) || !panelRef.current || maximized) return
    const panel = panelRef.current.getBoundingClientRect()
    dragOffset.current = { x: event.clientX - panel.left, y: event.clientY - panel.top }
    capturePointer(event.currentTarget, event.pointerId)
  }

  function onHeaderPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragOffset.current || !panelRef.current) return
    const panel = panelRef.current.getBoundingClientRect()
    const { width, height } = viewport()
    // Clamp to the live viewport so the window can never be dragged off to another monitor.
    const maxX = Math.max(0, width - panel.width)
    const maxY = Math.max(0, height - panel.height)
    setPosition({
      x: clamp(event.clientX - dragOffset.current.x, 0, maxX),
      y: clamp(event.clientY - dragOffset.current.y, 0, maxY),
    })
  }

  function onHeaderPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    dragOffset.current = null
    releasePointer(event.currentTarget, event.pointerId)
  }

  function onResizeStart(event: React.PointerEvent<HTMLDivElement>, dir: ResizeDir) {
    // button may be undefined in environments without a real pointer event (e.g. jsdom).
    if ((event.button && event.button !== 0) || !panelRef.current || maximized) return
    event.preventDefault()
    const panel = panelRef.current.getBoundingClientRect()
    resizeStart.current = { x0: event.clientX, y0: event.clientY, w: panel.width, h: panel.height, dir, pos: { x: panel.left, y: panel.top } }
    // Anchor on the captured top-left so every resize is relative to the same origin.
    setPosition({ x: panel.left, y: panel.top })
    capturePointer(event.currentTarget, event.pointerId)
  }

  function onResizeMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = resizeStart.current
    if (!start) return
    const { width: vw, height: vh } = viewport()
    let width = start.w
    let height = start.h
    if (start.dir === 'e' || start.dir === 'se') width = start.w + (event.clientX - start.x0)
    if (start.dir === 's' || start.dir === 'se') height = start.h + (event.clientY - start.y0)
    const maxWidth = Math.max(MIN_WIDTH, vw - start.pos.x)
    const maxHeight = Math.max(MIN_HEIGHT, vh - start.pos.y)
    setSize({
      width: Math.round(clamp(width, MIN_WIDTH, maxWidth)),
      height: Math.round(clamp(height, MIN_HEIGHT, maxHeight)),
    })
  }

  function onResizeEnd(event: React.PointerEvent<HTMLDivElement>) {
    resizeStart.current = null
    releasePointer(event.currentTarget, event.pointerId)
  }

  const toggleMaximize = () => setMaximized((value) => !value)

  const rowCount = table ? toTabular(table).rows.length : 0

  const onDragOver = (event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    const name = event.dataTransfer.getData('text/plain')
    if (name) onPreview(name)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent"
      >
        <Table2 className="size-4" />
        Show preview
      </button>
    )
  }

  const maximizedStyle = { left: 0, top: 0, width: '100vw', height: '100vh' }
  const normalStyle = {
    ...(position ? { left: position.x, top: position.y } : { right: '1rem', top: '6rem' }),
    ...(size ? { width: size.width, height: size.height } : {}),
  }

  return (
    <div
      ref={panelRef}
      onDragEnter={() => setDragOver(true)}
      onDragLeave={(event) => {
        if (!panelRef.current?.contains(event.relatedTarget as Node)) setDragOver(false)
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={
        'fixed z-50 flex min-w-[17rem] flex-col overflow-hidden rounded-xl border bg-background shadow-lg transition-colors ' +
        (maximized ? 'inset-0 rounded-none' : 'w-[min(92vw,26rem)]') +
        (dragOver ? ' border-primary ring-2 ring-primary/30' : ' border-border')
      }
      style={maximized ? maximizedStyle : normalStyle}
    >
      <div
        role="presentation"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        onDoubleClick={toggleMaximize}
        className="flex shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b border-border bg-background/80 px-3 py-2 backdrop-blur active:cursor-grabbing"
      >
        <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {table ? table.name : 'Preview'}
        </span>
        {table && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {rowCount.toLocaleString()} row{rowCount === 1 ? '' : 's'}
          </span>
        )}
        <button
          type="button"
          onClick={toggleMaximize}
          aria-label={maximized ? 'Restore preview' : 'Maximize preview'}
          className="-mr-0.5 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Hide preview"
          className="-ml-0.5 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <div ref={bodyRef} className="h-full">
          {table ? (
            <div key={table.name} className="motion-safe:animate-preview-in">
              <TableViewer table={table} hideHeader height={bodyHeight} />
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-input px-4 py-10 text-center text-sm text-muted-foreground">
              Select a table to preview its data.
            </p>
          )}
        </div>
      </div>

      {!maximized && (
        <>
          <div
            role="separator"
            aria-label="Resize height"
            onPointerDown={(event) => onResizeStart(event, 's')}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize touch-none select-none"
          />
          <div
            role="separator"
            aria-label="Resize width"
            onPointerDown={(event) => onResizeStart(event, 'e')}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize touch-none select-none"
          />
          <div
            role="separator"
            aria-label="Resize preview"
            onPointerDown={(event) => onResizeStart(event, 'se')}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            className="absolute right-0 bottom-0 h-5 w-5 cursor-nwse-resize touch-none select-none"
          >
            <div className="absolute right-0.5 bottom-0.5 h-3.5 w-3.5 rounded-tl-[3px] border-b-[3px] border-r-[3px] border-muted-foreground/50" />
          </div>
        </>
      )}
    </div>
  )
}
