'use client'

import { useMemo } from 'react'
import { Download, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { ExtractionResult } from '@sql-extractor/core'

interface DownloadStepProps {
  extract: () => ExtractionResult | null
  onReset: () => void
}

function downloadSql(sql: string, filename: string) {
  const blob = new Blob([sql], { type: 'application/sql' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function DownloadStep({ extract, onReset }: DownloadStepProps) {
  const result = useMemo(() => extract(), [extract])

  function handleDownload() {
    if (!result) return
    downloadSql(result.sql, `${result.database}.extracted.sql`)
  }

  if (!result) return null

  return (
    <section aria-labelledby="step-download">
      <Label id="step-download" className="mb-3 block text-base font-semibold sm:text-sm">
        Download
      </Label>

      <div className="rounded-lg border border-input bg-accent/30 px-4 py-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Database</span>
          <span className="font-medium">{result.database}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tables</span>
          <span className="font-medium">{result.tableCount}</span>
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <Button onClick={handleDownload} className="flex-1">
          <Download className="size-4" />
          Download SQL
        </Button>
        <Button variant="outline" onClick={onReset}>
          <RotateCcw className="size-4" />
          Start over
        </Button>
      </div>
    </section>
  )
}
