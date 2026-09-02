'use client'

import { Database } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { RadioGroup, Radio } from '@/components/ui/radio-group'
import type { Database as DatabaseType } from '@sql-extractor/core'

interface DatabaseSelectProps {
  databases: DatabaseType[]
  value: string
  onChange: (name: string) => void
}

export function DatabaseSelect({ databases, value, onChange }: DatabaseSelectProps) {
  return (
    <section aria-labelledby="step-database">
      <Label id="step-database" className="mb-3 block text-base font-semibold sm:text-sm">
        Select database
      </Label>

      <RadioGroup value={value} onValueChange={onChange}>
        {databases.map((db) => (
          <label
            key={db.name}
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:bg-accent/50 has-[[data-slot=radio][data-checked]]:border-input has-[[data-slot=radio][data-checked]]:bg-accent/30"
          >
            <Radio value={db.name} />
            <Database className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm">{db.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {db.tables.length} {db.tables.length === 1 ? 'table' : 'tables'}
            </span>
          </label>
        ))}
      </RadioGroup>
    </section>
  )
}
