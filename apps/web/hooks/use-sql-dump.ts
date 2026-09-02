'use client'

import { useState, useCallback, useMemo } from 'react'
import { parseSqlDump, extractDatabase } from '@sql-extractor/core'
import type { SqlDump } from '@sql-extractor/core'

export type Step = 'file' | 'database' | 'tables' | 'download'

export function useSqlDump() {
  const [dump, setDump] = useState<SqlDump | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [selectedDatabase, setSelectedDatabase] = useState<string>('')
  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const step: Step = !dump ? 'file' : !selectedDatabase ? 'database' : selectedTables.length === 0 ? 'tables' : 'download'

  const database = useMemo(() =>
    dump?.databases.find((d) => d.name === selectedDatabase) ?? null,
    [dump, selectedDatabase]
  )

  const loadFile = useCallback((content: string, name: string): boolean => {
    try {
      const parsed = parseSqlDump(content)
      setDump(parsed)
      setFileName(name)
      setSelectedDatabase('')
      setSelectedTables([])
      setError(null)
      return true
    } catch {
      setError('Unable to parse SQL dump. Please check the file format.')
      return false
    }
  }, [])

  const selectDatabase = useCallback((name: string) => {
    setSelectedDatabase(name)
    setSelectedTables([])
    setError(null)
  }, [])

  const toggleTable = useCallback((tableName: string) => {
    setSelectedTables((prev) =>
      prev.includes(tableName)
        ? prev.filter((t) => t !== tableName)
        : [...prev, tableName]
    )
  }, [])

  const toggleAllTables = useCallback(() => {
    if (!database) return
    setSelectedTables((prev) =>
      prev.length === database.tables.length ? [] : database.tables.map((t) => t.name)
    )
  }, [database])

  const allTablesSelected = database != null && selectedTables.length === database.tables.length
  const someTablesSelected = selectedTables.length > 0 && !allTablesSelected

  const extract = useCallback(() => {
    if (!dump || !selectedDatabase || selectedTables.length === 0) return null
    return extractDatabase(dump, {
      database: selectedDatabase,
      tables: selectedTables,
    })
  }, [dump, selectedDatabase, selectedTables])

  const reset = useCallback(() => {
    setDump(null)
    setFileName('')
    setSelectedDatabase('')
    setSelectedTables([])
    setError(null)
  }, [])

  return {
    step,
    dump,
    fileName,
    selectedDatabase,
    selectedTables,
    database,
    error,
    allTablesSelected,
    someTablesSelected,
    loadFile,
    selectDatabase,
    toggleTable,
    toggleAllTables,
    extract,
    reset,
  }
}
