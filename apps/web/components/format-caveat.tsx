'use client'

import { TriangleAlert } from 'lucide-react'
import type { FormatDescriptor } from '@sql-extractor/core'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface FormatCaveatProps {
  /** The engine the loaded dump was read as, once one is loaded. */
  sourceFormat: FormatDescriptor | null
}

/**
 * Warn, before anyone exports, when the source holds something this tool
 * cannot represent.
 *
 * Only formats the catalog marks `lossy` reach here. Plenty of formats carry a
 * `note` worth reading without anything being lost, and warning about those
 * would train people to dismiss the warning that matters.
 */
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
