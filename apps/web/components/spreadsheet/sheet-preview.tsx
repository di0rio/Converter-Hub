'use client'

import { useEffect, useState } from 'react'
import { TableProperties } from 'lucide-react'
import type { WorkBook } from 'xlsx'
import { readPreview } from '@/lib/spreadsheet'
import { DataGrid } from '@/components/data-grid'
import { Spinner } from '@/components/ui/spinner'

interface SheetPreviewProps {
  workbook: WorkBook | null
  sheetName: string | null
  /** Total rows in the sheet, so the preview can say what it is not showing. */
  totalRows: number
}

/**
 * How many rows are read for the preview.
 *
 * Unlike a dump table, whose rows are already parsed by the time the SQL tool
 * shows them, reading a sheet's rows is work of its own — so the preview reads
 * a window rather than the whole thing, and says so. The grid still virtualises
 * what it is given, which is what keeps a wide sheet cheap to paint.
 */
const PREVIEW_ROWS = 500

/** A read-only look at the sheet that is about to be exported. */
export function SheetPreview({
  workbook,
  sheetName,
  totalRows,
}: SheetPreviewProps) {
  // The rows are tagged with the sheet they came from, so a result that
  // arrives after the selection moved on is simply never rendered, and the
  // effect never has to write state synchronously to clear stale content.
  const [cache, setCache] = useState<{
    workbook: WorkBook | null
    sheet: string | null
    rows: string[][]
  }>({ workbook: null, sheet: null, rows: [] })

  useEffect(() => {
    if (!workbook || !sheetName) return

    let active = true

    // One more than the window, because the first row read is the header that
    // names the columns rather than a row of data.
    readPreview(workbook, sheetName, PREVIEW_ROWS + 1)
      .then((next) => {
        if (active) setCache({ workbook, sheet: sheetName, rows: next })
      })
      .catch(() => {
        if (active) setCache({ workbook, sheet: sheetName, rows: [] })
      })

    return () => {
      active = false
    }
  }, [workbook, sheetName])

  // Two files can carry a sheet of the same name, so the workbook identity is
  // part of the match and not just the sheet name.
  const fresh =
    sheetName != null &&
    cache.sheet === sheetName &&
    cache.workbook === workbook
  const rows = fresh ? cache.rows : []
  const loading = sheetName != null && !fresh
  const empty = !sheetName || rows.length === 0

  // A sheet's first row is its header, the way Excel shows it.
  const [header = [], ...body] = rows

  const shown = Math.min(totalRows, PREVIEW_ROWS)

  return (
    <div className="flex h-full w-full flex-col gap-2">
      {sheetName && (
        <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="truncate text-sm font-medium">{sheetName}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {totalRows > PREVIEW_ROWS
              ? `first ${shown.toLocaleString()} of ${totalRows.toLocaleString()} rows`
              : `${totalRows.toLocaleString()} row${totalRows === 1 ? '' : 's'}`}
          </span>
        </div>
      )}

      <div
        className={
          'relative min-h-0 w-full flex-1 overflow-hidden rounded-xl border ' +
          'transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ' +
          (empty
            ? 'border-dashed border-border bg-muted/20'
            : 'border-solid border-border bg-card')
        }
      >
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/60">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        )}

        {empty && !loading && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <TableProperties
              className="size-5 text-muted-foreground/50"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">
              {sheetName ? 'This sheet is empty.' : 'No sheet open.'}
            </p>
            {!sheetName && (
              <p className="text-xs text-muted-foreground/70">
                Choose a spreadsheet to see its sheets here.
              </p>
            )}
          </div>
        )}

        {!empty && (
          <div className="h-full w-full motion-safe:animate-preview-in">
            <DataGrid columns={header} rows={body} bare />
          </div>
        )}
      </div>
    </div>
  )
}
