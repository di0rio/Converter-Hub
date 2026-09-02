'use client'

import { useRef } from 'react'
import { Upload } from 'lucide-react'
import { SUPPORTED_FORMATS } from '@sql-extractor/core'
import type { FormatConfidence, FormatDescriptor } from '@sql-extractor/core'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

interface FileUploadProps {
  onFile: (content: string, name: string) => void
  onError: (message: string) => void
  fileName: string | null
  /** The engine the loaded dump was read as, once one is loaded. */
  sourceFormat: FormatDescriptor | null
  /** Whether that engine was recognised or merely assumed. */
  confidence: FormatConfidence | null
}

const SUPPORTED_LABELS = SUPPORTED_FORMATS.map((format) => format.label).join(' · ')

/**
 * Say what was actually established. A dump carrying an engine's own markers
 * is named; plain SQL that carries none is read as MySQL, and says so rather
 * than claiming a detection.
 */
function describeSource(
  sourceFormat: FormatDescriptor | null,
  confidence: FormatConfidence | null,
): string {
  if (!sourceFormat) return `Supported: ${SUPPORTED_LABELS}.`

  return confidence === 'assumed'
    ? `No engine markers found — read as ${sourceFormat.label}.`
    : `Read as a ${sourceFormat.label} dump.`
}

export function FileUpload({
  onFile,
  onError,
  fileName,
  sourceFormat,
  confidence,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    file
      .text()
      .then((content) => {
        onFile(content, file.name)
      })
      .catch(() => {
        onError('That file could not be read. It may have been moved or renamed.')
      })

    // Reset input so the same file can be re-selected
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  return (
    <section aria-labelledby="step-file">
      <Label
        htmlFor="sql-file-input"
        id="step-file"
        className="mb-3 block text-base font-semibold sm:text-sm"
      >
        Select a database dump
      </Label>

      <input
        ref={inputRef}
        id="sql-file-input"
        type="file"
        accept=".sql,text/plain"
        className="sr-only"
        onChange={handleChange}
        aria-describedby="file-input-desc"
      />

      <Button
        variant="outline"
        onClick={() => inputRef.current?.click()}
        className="w-full justify-start"
      >
        <Upload className="size-4" />
        <span className="truncate">
          {fileName ?? 'Choose SQL file'}
        </span>
      </Button>

      <p id="file-input-desc" className="mt-2 text-xs text-muted-foreground">
        {describeSource(sourceFormat, confidence)} Processed entirely in your
        browser.
      </p>
    </section>
  )
}
