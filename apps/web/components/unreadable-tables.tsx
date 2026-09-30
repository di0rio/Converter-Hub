'use client'

import type { UnreadableTable } from '@sql-extractor/core'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

const REASONS: Record<UnreadableTable['reason'], string> = {
  virtual: 'is a virtual table, whose rows come from an extension',
  array: 'has array columns',
  external: 'keeps its rows in a separate external file',
  temporary: 'is a temporary table, so no rows are saved in the file',
  charset: 'uses a character set that is not supported',
  compressed: 'uses row or page compression',
  damaged: 'could not be decoded',
}

interface UnreadableTablesProps {
  tables: readonly UnreadableTable[]
  readableCount: number
}

export function UnreadableTables({
  tables,
  readableCount,
}: UnreadableTablesProps) {
  if (tables.length === 0) return null

  return (
    <Alert variant="info" role="status" className="motion-safe:animate-step-in">
      <AlertTitle>
        {tables.length} table{tables.length === 1 ? '' : 's'} could not be read
      </AlertTitle>
      <AlertDescription>
        <p>
          {readableCount === 0
            ? 'Nothing in this file can be exported.'
            : `${tables.length === 1 ? 'It is' : 'They are'} left out of the list and the export.`}
        </p>
        <ul className="mt-1 space-y-0.5">
          {tables.map((table) => (
            <li key={table.name}>
              <span className="font-medium text-foreground">{table.name}</span>{' '}
              {REASONS[table.reason]}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
