'use client'

import { SUPPORTED_FORMATS } from '@sql-extractor/core'
import type { DatabaseFormat } from '@sql-extractor/core'
import { Label } from '@/components/ui/label'

interface SourceFormatSelectProps {
  /** The engine the user pinned, or null while detection decides. */
  value: DatabaseFormat | null
  onChange: (format: DatabaseFormat | null) => void
}

const AUTO = 'auto'

/**
 * Let the reader overrule the detector.
 *
 * Detection is deliberately conservative, so it reports "assumed" for a dump
 * carrying no engine markers and refuses a file whose markers contradict each
 * other. Both are cases where the person holding the file knows more than the
 * detector does, and this is how they say so.
 *
 * The options come from the format registry, so this list cannot drift from
 * what the project can actually read.
 */
export function SourceFormatSelect({ value, onChange }: SourceFormatSelectProps) {
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
