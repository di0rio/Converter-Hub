'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

interface DataGridProps {
  columns: string[]
  rows: (string | null)[][]
  height?: number
  bare?: boolean
  nullLabel?: string
}

const ROW_HEIGHT = 33
const VIEWPORT_HEIGHT = 320
const OVERSCAN = 8

export function DataGrid({
  columns,
  rows,
  height,
  bare = false,
  nullLabel,
}: DataGridProps) {
  const [scrollTop, setScrollTop] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState<number | null>(null)

  const total = rows.length

  useEffect(() => {
    const el = scrollRef.current
    if (!bare || !el || typeof ResizeObserver === 'undefined') return

    const read = () => setMeasured(el.clientHeight)
    read()
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [bare, total])

  const viewportHeight = measured ?? height ?? VIEWPORT_HEIGHT
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(total, first + visibleCount)

  const window = useMemo(() => rows.slice(first, last), [rows, first, last])

  const padTop = first * ROW_HEIGHT
  const padBottom = Math.max(0, (total - last) * ROW_HEIGHT)

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className={
        bare
          ? 'no-scrollbar h-full overflow-auto'
          : 'no-scrollbar overflow-auto rounded-lg border border-input'
      }
      style={bare ? undefined : { height: viewportHeight }}
    >
      <table className="w-max min-w-full border-collapse text-sm">
        <thead
          className={
            'sticky top-0 z-10 ' + (bare ? 'bg-card' : 'bg-background')
          }
        >
          <tr className="border-b border-border">
            <th
              scope="col"
              className="w-12 px-3 py-2 text-right align-middle text-xs font-medium text-muted-foreground"
            >
              #
            </th>
            {columns.map((column, index) => (
              <th
                key={`${index}-${column}`}
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
              <td colSpan={columns.length + 1} style={{ height: padTop }} />
            </tr>
          )}

          {window.map((row, index) => {
            const rowNumber = first + index + 1
            return (
              <tr
                key={rowNumber}
                className="border-b border-border/60 last:border-0"
              >
                <td
                  className="px-3 py-1.5 text-right align-top text-xs tabular-nums text-muted-foreground"
                  style={{ height: ROW_HEIGHT }}
                >
                  {rowNumber}
                </td>
                {columns.map((column, columnIndex) => {
                  const value = row[columnIndex] ?? null
                  return (
                    <td
                      key={`${columnIndex}-${column}`}
                      className="max-w-xs truncate px-3 py-1.5 align-top"
                      title={value ?? undefined}
                    >
                      {value === null && nullLabel ? (
                        <span className="text-muted-foreground italic">
                          {nullLabel}
                        </span>
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
              <td colSpan={columns.length + 1} style={{ height: padBottom }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
