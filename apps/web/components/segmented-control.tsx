'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  segmentedControlItemVariants,
  segmentedControlRootClassName,
} from '@/lib/segmented-control'

export interface SegmentedOption<T extends string> {
  value: T
  /** Read by screen readers and shown as the pointer tooltip. */
  label: string
  icon: ReactNode
  /**
   * Draw the label next to the icon.
   *
   * Two icon-only groups side by side read as one undifferentiated row of
   * glyphs, so the group that names the bigger choice keeps its words at every
   * width and the one nested under it stays icons.
   */
  showLabel?: boolean
}

interface SegmentedControlProps<T extends string> {
  label: string
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  className?: string
}

/**
 * A compact radio group drawn as one pill of choices.
 *
 * Native radio semantics rather than a set of toggle buttons, so the group
 * reads as "one of these" and arrow keys move between the options for free.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  const move = (from: number, step: number) => {
    const next = options[(from + step + options.length) % options.length]
    onChange(next.value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(segmentedControlRootClassName, className)}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            // Only the selected option is a tab stop, so the group behaves like
            // one control rather than one stop per choice.
            tabIndex={selected ? 0 : -1}
            data-checked={selected ? '' : undefined}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              const step =
                event.key === 'ArrowRight' || event.key === 'ArrowDown'
                  ? 1
                  : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                    ? -1
                    : 0
              if (!step) return
              event.preventDefault()
              move(index, step)
            }}
            className={cn(
              segmentedControlItemVariants({ size: 'sm', state: 'checked' }),
              // Press feedback is instant and the settle is short: this control
              // gets clicked often, so anything slower reads as lag.
              'transition-[background-color,color,box-shadow,transform] duration-150',
              'ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]',
            )}
          >
            {option.icon}
            {option.showLabel && <span>{option.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
