'use client'

import { Download, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { ExportResult } from '@sql-extractor/core'
import type { ConversionStatus } from '@/hooks/use-sql-dump'

interface DownloadStepProps {
  status: ConversionStatus
  result: ExportResult | null
  tableCount: number
  onConvert: () => void
  onReset: () => void
  onError: (message: string) => void
}

export function DownloadStep({
  status,
  result,
  tableCount,
  onConvert,
  onReset,
  onError,
}: DownloadStepProps) {
  function handleDownload() {
    if (!result) return

    try {
      // Copy into a fresh buffer: the Blob constructor needs a plain
      // ArrayBuffer, and this keeps the archive bytes off any shared view.
      const buffer = new ArrayBuffer(result.bytes.byteLength)
      new Uint8Array(buffer).set(result.bytes)

      const url = URL.createObjectURL(
        new Blob([buffer], { type: 'application/zip' }),
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.filename
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      onError('The download could not be started. Check your browser settings.')
    }
  }

  return (
    <section aria-labelledby="step-download">
      <Label
        id="step-download"
        className="mb-3 block text-base font-semibold sm:text-sm"
      >
        Convert and download
      </Label>

      {result ? (
        <div className="rounded-lg border border-input bg-accent/30 px-4 py-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Archive</span>
            <span className="font-medium">{result.filename}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tables</span>
            <span className="font-medium">{result.tableCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Files</span>
            <span className="font-medium">{result.files.length}</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {tableCount} table{tableCount === 1 ? '' : 's'} ready to convert.
        </p>
      )}

      <div className="mt-4 flex gap-3">
        {result ? (
          <Button onClick={handleDownload} className="flex-1">
            <Download className="size-4" />
            Download ZIP
          </Button>
        ) : (
          <Button
            onClick={onConvert}
            disabled={status === 'converting'}
            className="flex-1"
          >
            {status === 'converting' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {status === 'converting' ? 'Converting...' : 'Convert'}
          </Button>
        )}

        <Button variant="outline" onClick={onReset}>
          <RotateCcw className="size-4" />
          Start over
        </Button>
      </div>
    </section>
  )
}
