'use client'

import type { CsvDelimiter } from '@sql-extractor/core'
import { Fieldset, FieldsetLegend } from '@/components/ui/fieldset'
import { Label } from '@/components/ui/label'
import { Radio, RadioGroup } from '@/components/ui/radio-group'

const DELIMITERS: { value: CsvDelimiter; label: string }[] = [
  { value: ',', label: 'Comma (,)' },
  { value: ';', label: 'Semicolon (;)' },
  { value: '\t', label: 'Tab' },
]

export function CsvDelimiterField({
  value,
  onChange,
}: {
  value: CsvDelimiter
  onChange: (value: CsvDelimiter) => void
}) {
  return (
    <Fieldset className="flex flex-col gap-3 motion-safe:animate-step-in">
      <FieldsetLegend className="text-sm">Delimiter</FieldsetLegend>
      <RadioGroup
        aria-label="CSV delimiter"
        value={value}
        onValueChange={(next) => onChange(next as CsvDelimiter)}
        className="flex-row flex-wrap gap-x-5 gap-y-2"
      >
        {DELIMITERS.map((option) => (
          <Label key={option.label}>
            <Radio value={option.value} />
            {option.label}
          </Label>
        ))}
      </RadioGroup>
    </Fieldset>
  )
}
