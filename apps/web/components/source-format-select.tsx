'use client'

import { useState } from 'react'
import { SUPPORTED_FORMATS } from '@sql-extractor/core'
import type { DatabaseFormat, FormatConfidence } from '@sql-extractor/core'
import { Label } from '@/components/ui/label'

interface SourceFormatSelectProps {
  /** The engine the user pinned, or null while detection decides. */
  value: DatabaseFormat | null
  onChange: (format: DatabaseFormat | null) => void
  /**
   * How the loaded dump was placed. `detected` means the file carried an
   * engine's own markers; `assumed` means it carried none; `null` means
   * detection produced no answer at all.
   */
  confidence: FormatConfidence | null
}

const AUTO = 'auto'

/**
 * Let the reader overrule the detector.
 *
 * Detection is conservative on purpose, which leaves two cases where the person
 * holding the file knows more than it does: a dump carrying no engine markers,
 * which is only ever *assumed* to be MySQL, and one whose markers contradict
 * each other, which is refused outright. In both the control is the point of
 * the screen, so it is shown open.
 *
 * When detection actually recognised the engine, the control is noise — the
 * answer is already right. It collapses to one line that opens it, which keeps
 * the common path down to file, database, tables.
 *
 * Options come from the format registry, so this list cannot drift from what
 * the project can read.
 */
export function SourceFormatSelect({
  value,
  onChange,
  confidence,
}: SourceFormatSelectProps) {
  // Certain only when the dump named its own engine and nothing was pinned.
  const settled = confidence === 'detected' && value === null
  const [open, setOpen] = useState(false)

  if (settled && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
      >
        Read as something else
      </button>
    )
  }

  return (
    <div className="mt-3">
      <Label
        htmlFor="source-format"
        className="mb-1.5 block text-xs font-normal text-muted-foreground"
      >
        Read as
      </Label>

      <select
        id="source-format"
        value={value ?? AUTO}
        onChange={(event) => {
          const next = event.target.value
          onChange(next === AUTO ? null : (next as DatabaseFormat))
        }}
        className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value={AUTO}>Auto-detect</option>
        {SUPPORTED_FORMATS.map((format) => (
          <option key={format.id} value={format.id}>
            {format.label}
          </option>
        ))}
      </select>
    </div>
  )
}
