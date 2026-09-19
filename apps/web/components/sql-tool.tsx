'use client'

import { useCallback, useState } from 'react'
import { SqlExtractor } from '@/components/sql-extractor'
import { SqliteConverter } from '@/components/sqlite-converter'
import { isSqliteSelection } from '@/lib/sqlite-files'

type Selection = { kind: 'dump' | 'sqlite'; files: File[] }

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
