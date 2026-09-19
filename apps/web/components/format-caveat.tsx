'use client'

import { TriangleAlert } from 'lucide-react'
import type { FormatDescriptor } from '@sql-extractor/core'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface FormatCaveatProps {
  sourceFormat: FormatDescriptor | null
}

export function FormatCaveat({ sourceFormat }: FormatCaveatProps) {
  if (!sourceFormat?.lossy || !sourceFormat.note) return null

  return (
    <Alert variant="warning">
      <TriangleAlert />
      <AlertTitle>{sourceFormat.label}: not everything converts</AlertTitle>
      <AlertDescription>{sourceFormat.note}</AlertDescription>
    </Alert>
  )
}
