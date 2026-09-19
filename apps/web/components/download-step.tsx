'use client'

import { Download, RotateCcw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { downloadFile } from '@/lib/download'

export interface ResultFact {
  label: string
  value: string
}

interface DownloadStepProps {
  id: string
  label: string
  pending: string
  actionLabel: string
  actionIcon: LucideIcon
  busyLabel: string
  busy: boolean
  progress?: { done: number; total: number } | null
  result: { filename: string; bytes: Uint8Array; type?: string } | null
  facts: ResultFact[]
  onRun: () => void
  onReset: () => void
  onError: (message: string) => void
}

export function DownloadStep({
  id,
  label,
  pending,
  actionLabel,
  actionIcon: ActionIcon,
  busyLabel,
  busy,
  progress,
  result,
  facts,
  onRun,
  onReset,
  onError,
}: DownloadStepProps) {
  function handleDownload() {
    if (!result) return

    try {
      downloadFile(
        result.bytes,
        result.filename,
        result.type ?? 'application/zip',
      )
    } catch {
      onError('The download could not be started. Check your browser settings.')
    }
  }

  const counting = busy && progress != null && progress.total > 1

  return (
    <section aria-labelledby={id}>
      <Label id={id} className="mb-3 block text-base font-semibold sm:text-sm">
        {label}
      </Label>

      {result ? (
        <dl className="rounded-lg border border-input bg-accent/30 px-4 py-3 text-sm">
          {facts.map((fact) => (
            <div key={fact.label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd className="truncate font-medium tabular-nums">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {counting
            ? `Processing ${progress.done} of ${progress.total}...`
            : pending}
        </p>
      )}

      <div className="mt-4 flex gap-3">
        {result ? (
          <Button className="flex-1" onClick={handleDownload}>
            <Download className="size-4" />
            Download {result.filename.split('.').pop()?.toUpperCase()}
          </Button>
        ) : (
          <Button className="flex-1" disabled={busy} onClick={onRun}>
            {busy ? (
              <Spinner className="size-4" />
            ) : (
              <ActionIcon className="size-4" />
            )}
            {busy ? busyLabel : actionLabel}
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
