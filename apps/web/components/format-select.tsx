'use client'

import { FileCode, FileSpreadsheet, Table } from 'lucide-react'
import { Label } from '@/components/ui/label'
import type { ExportFormat } from '@sql-extractor/core'

interface FormatSelectProps {
  value: ExportFormat
  onChange: (format: ExportFormat) => void
}

const FORMATS = [
  { id: 'sql' as const, label: 'SQL', hint: 'One .sql dump', Icon: FileCode },
  { id: 'csv' as const, label: 'CSV', hint: 'One file per table', Icon: Table },
  { id: 'xlsx' as const, label: 'Excel', hint: 'One sheet per table', Icon: FileSpreadsheet },
]

export function FormatSelect({ value, onChange }: FormatSelectProps) {
  return (
    <section aria-labelledby="step-format">
      <Label id="step-format" className="mb-3 block text-base font-semibold sm:text-sm">
        Export format
      </Label>

      <div role="radiogroup" aria-labelledby="step-format" className="grid grid-cols-3 gap-2">
        {FORMATS.map(({ id, label, hint, Icon }) => {
          const selected = value === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(id)}
              className={
                'flex flex-col items-center gap-1 rounded-lg border px-3 py-3 text-center transition-colors ' +
                (selected
                  ? 'border-primary bg-accent/50'
                  : 'border-input hover:bg-accent/30')
              }
            >
              <Icon className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
