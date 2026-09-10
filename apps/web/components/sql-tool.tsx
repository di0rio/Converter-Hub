'use client'

import { useCallback, useState } from 'react'
import { SqlExtractor } from '@/components/sql-extractor'
import { SqliteConverter } from '@/components/sqlite-converter'
import { isSqliteSelection } from '@/lib/sqlite-files'

type Selection = { kind: 'dump' | 'sqlite'; files: File[] }

/**
 * The SQL tool: one entry point for a dump and for a SQLite database.
 *
 * The two are read by different flows — a dump is parsed as text, a database
 * is opened by a SQLite engine — so each keeps its own component. This only
 * looks at what was picked and hands it to the flow that reads it, which is
 * also what happens when the next file picked is the other kind.
 */
export function SqlTool() {
  const [selection, setSelection] = useState<Selection | null>(null)

  const route = useCallback(async (files: File[]) => {
    const kind = (await isSqliteSelection(files)) ? 'sqlite' : 'dump'
    setSelection({ kind, files })
  }, [])

  return selection?.kind === 'sqlite' ? (
    <SqliteConverter selection={selection.files} onFiles={route} />
  ) : (
    <SqlExtractor selection={selection?.files} onFiles={route} />
  )
}
