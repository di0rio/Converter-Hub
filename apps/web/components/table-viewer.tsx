'use client'

import { useMemo } from 'react'
import { toTabular } from '@sql-extractor/core'
import type { Table } from '@sql-extractor/core'
import { DataGrid } from '@/components/data-grid'
import { Label } from '@/components/ui/label'

interface TableViewerProps {
  table: Table
  hideHeader?: boolean
  height?: number
  bare?: boolean
}

export function TableViewer({
  table,
  hideHeader = false,
  height,
  bare = false,
}: TableViewerProps) {
  const data = useMemo(() => toTabular(table), [table])
  const total = data.rows.length

  const messageFrame = bare
    ? 'px-4 py-6 text-center text-sm text-muted-foreground'
    : 'rounded-lg border border-input px-4 py-6 text-center text-sm text-muted-foreground'

  return (
    <section
      aria-labelledby="step-preview"
      className={bare ? 'h-full' : undefined}
    >
      {!hideHeader && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <Label
            id="step-preview"
            className="text-base font-semibold sm:text-sm"
          >
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
        <p className={messageFrame}>
          No columns could be read from this table.
        </p>
      ) : total === 0 ? (
        <p className={messageFrame}>This table has no data rows.</p>
      ) : (
        <DataGrid
          columns={data.columns}
          rows={data.rows}
          height={height}
          bare={bare}
          nullLabel="NULL"
        />
      )}
    </section>
  )
}
