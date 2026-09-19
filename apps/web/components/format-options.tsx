'use client'

import type { LucideIcon } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Radio, RadioGroup } from '@/components/ui/radio-group'

export interface FormatOption<T extends string> {
  id: T
  label: string
  hint: string
  Icon: LucideIcon
}

interface FormatOptionsProps<T extends string> {
  id: string
  label: string
  options: FormatOption<T>[]
  value: T
  onChange: (value: T) => void
}

export function FormatOptions<T extends string>({
  id,
  label,
  options,
  value,
  onChange,
}: FormatOptionsProps<T>) {
  return (
    <section aria-labelledby={id}>
      <Label id={id} className="mb-3 block text-base font-semibold sm:text-sm">
        {label}
      </Label>

      <RadioGroup
        aria-labelledby={id}
        value={value}
        onValueChange={(next) => onChange(next as T)}
        className="grid gap-2 sm:grid-cols-2"
      >
        {options.map(({ id: optionId, label: optionLabel, hint, Icon }) => (
          <label
            key={optionId}
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-input px-3 py-2.5 transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-accent/30 has-[[data-slot=radio][data-checked]]:border-primary has-[[data-slot=radio][data-checked]]:bg-accent/50"
          >
            <Radio value={optionId} />
            <Icon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{optionLabel}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {hint}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </section>
  )
}
