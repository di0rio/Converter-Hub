'use client'

import { useEffect, useState } from 'react'
import type { WorkBook } from 'xlsx'
import { readSheetRows } from '@/lib/spreadsheet'
import { DataGrid } from '@/components/data-grid'
import { Spinner } from '@/components/ui/spinner'

/**
 * Rows already read, per workbook.
 *
 * Reading a sheet is real work, and the workspace remounts a viewer every time
 * a tab is switched or a window is reopened. A WeakMap keyed on the workbook
 * lets the cache die with the file it belongs to, so loading a new workbook
 * cannot serve rows from the old one and nothing has to be invalidated by hand.
 */
const cache = new WeakMap<WorkBook, Map<string, string[][]>>()

function cached(workbook: WorkBook, name: string): string[][] | undefined {
  return cache.get(workbook)?.get(name)
}

function remember(workbook: WorkBook, name: string, rows: string[][]) {
  let forWorkbook = cache.get(workbook)
  if (!forWorkbook) {
    forWorkbook = new Map()
    cache.set(workbook, forWorkbook)
  }
  forWorkbook.set(name, rows)
}

interface SheetViewerProps {
  workbook: WorkBook
  name: string
}

/**
 * One sheet, drawn in the grid the SQL tool draws its tables in.
 *
 * Unlike a dump table — already parsed by the time the SQL tool shows it — a
 * sheet has to be read on demand, so this owns the read and the cache. What it
 * hands to the grid is the same shape either tool produces: a header row and
 * rows of text.
 */
export function SheetViewer({ workbook, name }: SheetViewerProps) {
  // Tagged with the sheet it came from, so a read that lands after the
  // selection moved on is never rendered and the effect never has to write
  // state synchronously to clear stale content.
  const [read, setRead] = useState<{
    workbook: WorkBook
    name: string
    rows: string[][]
  } | null>(null)

  const ready = cached(workbook, name)

  useEffect(() => {
    // Already read once for this workbook: render straight from the cache.
    if (cached(workbook, name)) return

    let active = true

    readSheetRows(workbook, name)
      .then((next) => {
        remember(workbook, name, next)
        if (active) setRead({ workbook, name, rows: next })
      })
      .catch(() => {
        if (active) setRead({ workbook, name, rows: [] })
      })

    return () => {
      active = false
    }
  }, [workbook, name])

  const rows =
    ready ??
    (read && read.workbook === workbook && read.name === name
      ? read.rows
      : null)

  if (rows === null) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        This sheet has no data rows.
      </p>
    )
  }

  // A sheet's first row is its header, the way Excel shows it.
  const [header = [], ...body] = rows

  return <DataGrid columns={header} rows={body} bare />
}
