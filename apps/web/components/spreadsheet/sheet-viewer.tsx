'use client'

import { useEffect, useState } from 'react'
import type { WorkBook } from 'xlsx'
import { readSheetRows } from '@/lib/spreadsheet'
import { DataGrid } from '@/components/data-grid'
import { Spinner } from '@/components/ui/spinner'

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

export function SheetViewer({ workbook, name }: SheetViewerProps) {
  const [read, setRead] = useState<{
    workbook: WorkBook
    name: string
    rows: string[][]
  } | null>(null)

  const ready = cached(workbook, name)

  useEffect(() => {
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

  const [header = [], ...body] = rows

  return <DataGrid columns={header} rows={body} bare />
}
