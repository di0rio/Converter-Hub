'use client'

import { X } from 'lucide-react'
import type { Table } from '@sql-extractor/core'
import { TableViewer } from '@/components/table-viewer'
import type {
  FullLayout,
  PreviewWindow as PreviewWindowState,
} from '@/hooks/use-preview-windows'

interface FullPreviewProps {
  layout: FullLayout
  /** Open tables in insertion order, so nothing reshuffles under the pointer. */
  windows: PreviewWindowState[]
  tables: Map<string, Table>
  rowCounts: Map<string, number>
  /** The front-most window: the one a tabbed or single layout shows. */
  activeId: string | null
  onFocus: (id: string) => void
  onClose: (id: string) => void
}

const rowLabel = (rows: number) =>
  `${rows.toLocaleString()} row${rows === 1 ? '' : 's'}`

/**
 * The default preview: a table given the whole workspace.
 *
 * Three ways to share that space, none of which overlap — overlapping is what
 * the windowed mode is for. `tabs` keeps every open table one click away,
 * `single` shows exactly one, `split` tiles them for comparison.
 */
export function FullPreview({
  layout,
  windows,
  tables,
  rowCounts,
  activeId,
  onFocus,
  onClose,
}: FullPreviewProps) {
  if (layout === 'split') {
    // Roughly square, capped at three across so a column never gets too narrow
    // to read a value in.
    const columns = Math.min(
      3,
      Math.max(1, Math.ceil(Math.sqrt(windows.length))),
    )
    return (
      <div
        className="grid h-full w-full auto-rows-fr gap-2 p-2"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {windows.map((w) => (
          <section
            key={w.id}
            aria-label={`${w.tableName} preview`}
            onPointerDown={() => onFocus(w.id)}
            className={
              'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card ' +
              'motion-safe:animate-preview-in transition-shadow duration-200 ' +
              'ease-[cubic-bezier(0.23,1,0.32,1)] ' +
              (w.id === activeId
                ? 'border-input shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]'
                : 'border-border')
            }
          >
            <PanelHeader
              name={w.tableName}
              rows={rowCounts.get(w.tableName) ?? 0}
              onClose={() => onClose(w.id)}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
              <TableViewer table={tables.get(w.tableName)!} hideHeader bare />
            </div>
          </section>
        ))}
      </div>
    )
  }

  const active = windows.find((w) => w.id === activeId) ?? windows[0]
  if (!active) return null

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {layout === 'tabs' ? (
        <div
          role="tablist"
          aria-label="Open table previews"
          className="no-scrollbar flex shrink-0 items-end gap-1 overflow-x-auto border-b border-border bg-muted/25 px-2 pt-2"
        >
          {windows.map((w) => {
            const selected = w.id === active.id
            return (
              <div
                key={w.id}
                className={
                  'group flex shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 py-1.5 ' +
                  'transition-[background-color,color,border-color] duration-150 ' +
                  'ease-[cubic-bezier(0.23,1,0.32,1)] ' +
                  (selected
                    ? // The selected tab merges into the panel below it, so the
                      // strip reads as one surface with a raised card on it.
                      'relative -mb-px border-border bg-card pb-2 text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground')
                }
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onFocus(w.id)}
                  onKeyDown={(event) => {
                    const step =
                      event.key === 'ArrowRight'
                        ? 1
                        : event.key === 'ArrowLeft'
                          ? -1
                          : 0
                    if (!step) return
                    event.preventDefault()
                    const index = windows.findIndex((t) => t.id === w.id)
                    const next =
                      windows[(index + step + windows.length) % windows.length]
                    onFocus(next.id)
                  }}
                  className="flex min-w-0 items-center gap-2 text-xs font-medium outline-none"
                >
                  <span className="max-w-[12rem] truncate">{w.tableName}</span>
                  <span className="text-[11px] font-normal text-muted-foreground tabular-nums">
                    {(rowCounts.get(w.tableName) ?? 0).toLocaleString()}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onClose(w.id)}
                  aria-label={`Close ${w.tableName} preview`}
                  title={`Close ${w.tableName} preview`}
                  className={
                    '-mr-1.5 rounded p-0.5 text-muted-foreground ' +
                    'transition-[opacity,background-color,color,transform] duration-150 ' +
                    'ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-90 ' +
                    'hover:bg-accent hover:text-foreground ' +
                    'focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ' +
                    (selected
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100')
                  }
                >
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <PanelHeader
          name={active.tableName}
          rows={rowCounts.get(active.tableName) ?? 0}
          onClose={() => onClose(active.id)}
        />
      )}

      <div
        role="tabpanel"
        aria-label={`${active.tableName} preview`}
        // Keyed on the table so switching tabs remounts the viewer: the scroll
        // position belongs to the table, not to the panel it happens to be in.
        key={active.id}
        className="min-h-0 flex-1 overflow-hidden bg-card motion-safe:animate-preview-in"
      >
        <TableViewer table={tables.get(active.tableName)!} hideHeader bare />
      </div>
    </div>
  )
}

/** The name-and-rows strip a non-tabbed panel carries instead of a tab. */
function PanelHeader({
  name,
  rows,
  onClose,
}: {
  name: string
  rows: number
  onClose: () => void
}) {
  return (
    <div className="flex h-[33px] shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-2.5">
      <span className="min-w-0 flex-1 truncate text-xs font-medium">
        {name}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {rowLabel(rows)}
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${name} preview`}
        title={`Close ${name} preview`}
        className={
          '-mr-1 shrink-0 rounded p-1 text-muted-foreground ' +
          'transition-[background-color,color,transform] duration-150 ' +
          'ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-90 ' +
          'hover:bg-destructive/10 hover:text-destructive ' +
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
        }
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
