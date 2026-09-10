'use client'

import type { LucideIcon } from 'lucide-react'
import { Label } from '@/components/ui/label'

export interface FormatOption<T extends string> {
  id: T
  label: string
  /** What choosing it produces, in the fewest words that are still true. */
  hint: string
  Icon: LucideIcon
}

interface FormatOptionsProps<T extends string> {
  /** Unique per page: ties the group to its own label. */
  id: string
  label: string
  options: FormatOption<T>[]
  value: T
  onChange: (value: T) => void
}

// Tailwind reads class names literally, so the column count cannot be built
// from a variable.
const COLUMNS: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
}

/**
 * The output-format picker, shared by every tool.
 *
 * What a tool reads and what it writes are separate choices; this is only the
 * second one, which is why it takes its options rather than knowing any.
 */
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

      <div
        role="radiogroup"
        aria-labelledby={id}
        className={`grid gap-2 ${COLUMNS[options.length] ?? 'grid-cols-2'}`}
      >
        {options.map(({ id: optionId, label: optionLabel, hint, Icon }) => {
          const selected = value === optionId
          return (
            <button
              key={optionId}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(optionId)}
              className={
                'flex cursor-pointer flex-col items-center gap-1 rounded-lg border px-3 py-3 text-center transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ' +
                (selected
                  ? 'border-primary bg-accent/50'
                  : 'border-input hover:bg-accent/30')
              }
            >
              <Icon
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="text-sm font-medium">{optionLabel}</span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
