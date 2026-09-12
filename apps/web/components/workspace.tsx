'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AppWindow,
  LayoutGrid,
  Maximize2,
  PanelsTopLeft,
  Square,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { PreviewWindow } from '@/components/preview-window'
import { FullPreview } from '@/components/full-preview'
import { SegmentedControl } from '@/components/segmented-control'
import {
  frontWindow,
  WINDOW_DEFAULT_WIDTH,
  type FullLayout,
  type PreviewMode,
  type PreviewWindow as PreviewWindowState,
  type Rect,
} from '@/hooks/use-preview-windows'

/**
 * The drag payload a row writes, so a stray text drop is ignored.
 *
 * One type for both tools: a workspace only ever sees drops from the list
 * beside it, and the names it accepts are checked against `names` anyway.
 */
export const PREVIEW_DRAG_TYPE = 'application/x-converter-preview'

interface WorkspaceProps {
  /** Names that may be open. A window whose name is gone stops rendering. */
  names: string[]
  /** Whether there is anything loaded yet; hides the controls when not. */
  ready: boolean
  /** Draws one open item. This is all the workspace knows about content. */
  renderPreview: (name: string) => ReactNode
  /** What one open thing is called: "table", "sheet". */
  noun: string
  /** Drawn in the empty state, above the invitation to drop. */
  emptyIcon: LucideIcon
  windows: PreviewWindowState[]
  rowCounts: Map<string, number>
  mode: PreviewMode
  layout: FullLayout
  onOpen: (name: string, at?: { x: number; y: number }) => void
  onClose: (id: string) => void
  onCloseAll: () => void
  onFocus: (id: string) => void
  onMinimize: (id: string) => void
  onMaximize: (id: string) => void
  onModeChange: (mode: PreviewMode) => void
  onLayoutChange: (layout: FullLayout) => void
  onChange: (
    id: string,
    patch: Partial<Omit<PreviewWindowState, 'id' | 'name'>>,
  ) => void
  /** Report the measured workspace size, which clamps every window. */
  onMeasure: (bounds: { width: number; height: number }) => void
}

const MODE_OPTIONS = [
  {
    value: 'full' as const,
    label: 'Full',
    icon: <Maximize2 />,
    showLabel: true,
  },
  {
    value: 'windows' as const,
    label: 'Windows',
    icon: <AppWindow />,
    showLabel: true,
  },
]

const LAYOUT_OPTIONS = [
  { value: 'tabs' as const, label: 'Tabs', icon: <PanelsTopLeft /> },
  { value: 'single' as const, label: 'Single', icon: <Square /> },
  { value: 'split' as const, label: 'Split', icon: <LayoutGrid /> },
]

/**
 * The visualisation half of every tool: the surface that accepts dropped
 * items and decides how the open ones share the space.
 *
 * It knows nothing about what it is showing - a dump table and a spreadsheet
 * sheet both arrive as a name and a node to draw.
 *
 * It owns its own size (measured, not assumed) because every window position is
 * workspace-relative and has to be re-contained when the area changes.
 */
export function Workspace({
  names,
  ready,
  renderPreview,
  noun,
  emptyIcon: EmptyIcon,
  windows,
  rowCounts,
  mode,
  layout,
  onOpen,
  onClose,
  onCloseAll,
  onFocus,
  onMinimize,
  onMaximize,
  onModeChange,
  onLayoutChange,
  onChange,
  onMeasure,
}: WorkspaceProps) {
  const ref = useRef<HTMLDivElement>(null)
  // Counts nested dragenter/dragleave pairs; a plain boolean flickers off when
  // the pointer crosses a child element.
  const dragDepth = useRef(0)
  const [dragOver, setDragOver] = useState(false)
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  // The region the window being dragged would take on release.
  const [snap, setSnap] = useState<Rect | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const measure = () => {
      const next = { width: el.clientWidth, height: el.clientHeight }
      setBounds((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next,
      )
      onMeasure(next)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [onMeasure])

  // A window is closed while a drag may still be armed; a stale guide would
  // otherwise stay painted over an empty workspace.
  const clearSnap = useCallback(() => setSnap(null), [])

  const accepts = (event: React.DragEvent) =>
    event.dataTransfer.types.includes(PREVIEW_DRAG_TYPE)

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

    const name = event.dataTransfer.getData(PREVIEW_DRAG_TYPE)
    if (!name) return

    const target = event.currentTarget
    // Re-measure before placing. The observer reports asynchronously, so a drop
    // that lands right after a layout change would otherwise be clamped against
    // a stale size and could sit slightly outside.
    onMeasure({ width: target.clientWidth, height: target.clientHeight })

    // A full-width preview ignores the drop point, so only the windowed mode
    // pays for reading it.
    if (mode !== 'windows') {
      onOpen(name)
      return
    }

    // Offsets are relative to the padding box, which is the containing block
    // for the absolutely positioned windows, so the border is subtracted out.
    const rect = target.getBoundingClientRect()
    const style = window.getComputedStyle(target)
    const originX = rect.left + parseFloat(style.borderLeftWidth)
    const originY = rect.top + parseFloat(style.borderTopWidth)

    // Drop where the pointer landed, biased so the window opens under the
    // cursor rather than hanging off it.
    onOpen(name, {
      x: event.clientX - originX - WINDOW_DEFAULT_WIDTH / 2,
      y: event.clientY - originY - 16,
    })
  }

  const available = new Set(names)
  // A window whose item vanished (database or workbook switched) must not
  // render.
  const open = windows.filter((w) => available.has(w.name))
  const activeId = frontWindow(open)?.id ?? null
  const empty = open.length === 0

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-2">
      {ready && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SegmentedControl
            label="Preview mode"
            value={mode}
            options={MODE_OPTIONS}
            onChange={onModeChange}
          />

          {mode === 'full' && (
            <SegmentedControl
              label="Full preview layout"
              value={layout}
              options={LAYOUT_OPTIONS}
              onChange={onLayoutChange}
            />
          )}

          {!empty && (
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                {open.length} open
              </span>
              <button
                type="button"
                onClick={onCloseAll}
                className={
                  'rounded-md px-2 py-1 text-xs font-medium text-muted-foreground ' +
                  'transition-[background-color,color,transform] duration-150 ' +
                  'ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] ' +
                  'hover:bg-accent hover:text-foreground ' +
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                }
              >
                Close all
              </button>
            </div>
          )}
        </div>
      )}

      <div
        ref={ref}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        aria-label="Preview workspace"
        className={
          'relative min-h-0 w-full flex-1 overflow-hidden rounded-xl border ' +
          'transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ' +
          // The dashed outline is an invitation to drop. Once a table is on
          // screen the frame turns solid and stops competing with the data.
          (empty ? 'border-dashed ' : 'border-solid ') +
          (dragOver
            ? 'border-ring bg-accent/40'
            : empty
              ? 'border-border bg-muted/20'
              : 'border-border bg-card')
        }
      >
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <EmptyIcon
              className="size-5 text-muted-foreground/50"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">
              {dragOver
                ? `Drop to preview this ${noun}`
                : `Drop a ${noun} here to preview it`}
            </p>
            {!dragOver && (
              <p className="text-xs text-muted-foreground/70">
                Drag one from the list, or press Preview on it.
              </p>
            )}
          </div>
        )}

        {!empty && mode === 'full' && (
          <FullPreview
            layout={layout}
            windows={open}
            rowCounts={rowCounts}
            renderPreview={renderPreview}
            noun={noun}
            activeId={activeId}
            onFocus={onFocus}
            onClose={onClose}
          />
        )}

        {mode === 'windows' && (
          <>
            {/* The landing zone, drawn under the window being dragged so the
                window itself is never hidden by its own guide. */}
            {snap && (
              <div
                aria-hidden="true"
                className={
                  // Dashed, like the empty workspace: the app already uses that
                  // outline to mean "something lands here".
                  'pointer-events-none absolute z-0 rounded-xl border-2 border-dashed ' +
                  'border-primary/45 bg-primary/[0.07] motion-safe:animate-snap-in ' +
                  'transition-[left,top,width,height] duration-150 ' +
                  'ease-[cubic-bezier(0.23,1,0.32,1)]'
                }
                style={{
                  left: snap.x,
                  top: snap.y,
                  width: snap.width,
                  height: snap.height,
                }}
              />
            )}

            {open.map((w) => (
              <PreviewWindow
                key={w.id}
                window={w}
                name={w.name}
                rowCount={rowCounts.get(w.name) ?? 0}
                active={w.id === activeId}
                bounds={bounds}
                onFocus={() => onFocus(w.id)}
                onClose={() => {
                  clearSnap()
                  onClose(w.id)
                }}
                onMinimize={() => onMinimize(w.id)}
                onMaximize={() => onMaximize(w.id)}
                onChange={(patch) => onChange(w.id, patch)}
                onSnapPreview={setSnap}
              >
                {renderPreview(w.name)}
              </PreviewWindow>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
