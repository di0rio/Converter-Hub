'use client'

import { Download, RotateCcw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { downloadZip } from '@/lib/download'

/** One line of the "what you are about to get" summary. */
export interface ResultFact {
  label: string
  value: string
}

interface DownloadStepProps {
  /** Unique per page: ties the section to its own heading. */
  id: string
  label: string
  /** What to say before the archive exists, e.g. "3 tables ready to convert." */
  pending: string
  /** The button that starts the work, and what it says while working. */
  actionLabel: string
  actionIcon: LucideIcon
  busyLabel: string
  busy: boolean
  /**
   * Real counted progress, when the work reports any. A tool that cannot say
   * how far along it is passes nothing and gets a plain spinner instead of an
   * invented number.
   */
  progress?: { done: number; total: number } | null
  /** The finished archive, once there is one. */
  result: { filename: string; bytes: Uint8Array } | null
  facts: ResultFact[]
  onRun: () => void
  onReset: () => void
  onError: (message: string) => void
}

/**
 * The last step of every tool: run the conversion, then take the ZIP.
 *
 * Both tools end the same way, so this is one component rather than two that
 * drift apart — the wording and the summary lines are what differ, and they
 * are passed in.
 */
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
      downloadZip(result.bytes, result.filename)
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
        <p
          className="text-sm text-muted-foreground"
          // The count changes as the work runs, and a reader who is not
          // watching the button should still hear it.
          aria-live="polite"
        >
          {counting
            ? `Processing ${progress.done} of ${progress.total}...`
            : pending}
        </p>
      )}

      <div className="mt-4 flex gap-3">
        {result ? (
          <Button className="flex-1" onClick={handleDownload}>
            <Download className="size-4" />
            Download ZIP
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
