'use client'

import { useMemo, useRef, useState } from 'react'
import { toTabular } from '@sql-extractor/core'
import type { Table } from '@sql-extractor/core'
import { Label } from '@/components/ui/label'

interface TableViewerProps {
  table: Table
  /** When embedding inside a panel that provides its own header, drop the built-in one. */
  hideHeader?: boolean
  /** Height of the scroll viewport in px, for a resizable parent. Defaults to a fixed 320. */
  height?: number
}

const ROW_HEIGHT = 33
const VIEWPORT_HEIGHT = 320
// Rows rendered above and below the viewport so fast scrolling stays filled.
const OVERSCAN = 8

export function TableViewer({ table, hideHeader = false, height }: TableViewerProps) {
  const [scrollTop, setScrollTop] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Parsing is the expensive step, so it happens once per table, not per render.
  const data = useMemo(() => toTabular(table), [table])
  const total = data.rows.length

  const viewportHeight = height ?? VIEWPORT_HEIGHT
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(total, first + visibleCount)

  // Only the visible window becomes DOM nodes; the rest is padding height.
  const window = useMemo(() => data.rows.slice(first, last), [data.rows, first, last])

  const padTop = first * ROW_HEIGHT
  const padBottom = Math.max(0, (total - last) * ROW_HEIGHT)

  return (
    <section aria-labelledby="step-preview">
      {!hideHeader && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <Label id="step-preview" className="text-base font-semibold sm:text-sm">
            Preview
          </Label>
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{table.name}</span>
            {' · '}
            {total.toLocaleString()} row{total === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {data.columns.length === 0 ? (
        <p className="rounded-lg border border-input px-4 py-6 text-center text-sm text-muted-foreground">
          No columns could be read from this table.
        </p>
      ) : total === 0 ? (
        <p className="rounded-lg border border-input px-4 py-6 text-center text-sm text-muted-foreground">
          This table has no data rows.
        </p>
      ) : (
        <div
          ref={scrollRef}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          className="no-scrollbar overflow-auto rounded-lg border border-input"
          style={{ height: viewportHeight }}
        >
          <table className="w-max min-w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b border-border">
                <th
                  scope="col"
                  className="w-12 px-3 py-2 text-right align-middle text-xs font-medium text-muted-foreground"
                >
                  #
                </th>
                {data.columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2 text-left align-middle text-xs font-medium"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {padTop > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={data.columns.length + 1} style={{ height: padTop }} />
                </tr>
              )}

              {window.map((row, index) => {
                const rowNumber = first + index + 1
                return (
                  <tr key={rowNumber} className="border-b border-border/60 last:border-0">
                    <td
                      className="px-3 py-1.5 text-right align-top text-xs tabular-nums text-muted-foreground"
                      style={{ height: ROW_HEIGHT }}
                    >
                      {rowNumber}
                    </td>
                    {data.columns.map((column, columnIndex) => {
                      const value = row[columnIndex]
                      return (
                        <td
                          key={column}
                          className="max-w-xs truncate px-3 py-1.5 align-top"
                          title={value ?? undefined}
                        >
                          {value === null ? (
                            <span className="text-muted-foreground italic">NULL</span>
                          ) : (
                            value
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}

              {padBottom > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={data.columns.length + 1} style={{ height: padBottom }} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
