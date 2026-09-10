'use client'

import { useRef, useState } from 'react'
import { FileCheck2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

interface FileSelectProps {
  /** Unique per page: ties the label, the input and its description together. */
  id: string
  /** The step's heading, e.g. "Select a database dump". */
  label: string
  /** What the button says before a file is chosen. */
  buttonLabel: string
  /** Extensions this tool reads, lowercase and dotted: ['.xlsx', '.csv']. */
  accept: string[]
  /** The chosen file's name, once there is one. */
  fileName: string | null
  reading?: boolean
  /** The line under the control. Both tools use it to say nothing is uploaded. */
  description: string
  onFile: (file: File) => void
  onError: (message: string) => void
}

/** Named the way someone would read them aloud: ".xlsx, .xls or .csv". */
export function listExtensions(accept: string[]): string {
  if (accept.length <= 1) return accept.join('')
  return `${accept.slice(0, -1).join(', ')} or ${accept[accept.length - 1]}`
}

/**
 * The entry point of every tool.
 *
 * One quiet row, not a large dashed target: this step is passed through once
 * and then sits at the top of a column of steps for the rest of the session, so
 * it should not outweigh the choices that follow it. It still accepts a drop —
 * the affordance costs nothing here — and it is a real button, so the keyboard
 * and a screen reader get the same path as the mouse.
 */
export function FileSelect({
  id,
  label,
  buttonLabel,
  accept,
  fileName,
  reading = false,
  description,
  onFile,
  onError,
}: FileSelectProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  // Counts nested dragenter/dragleave pairs; a plain boolean flickers off when
  // the pointer crosses a child element.
  const dragDepth = useRef(0)
  const [dragOver, setDragOver] = useState(false)

  function handle(file: File | undefined) {
    if (!file) return

    const name = file.name.toLowerCase()
    if (!accept.some((extension) => name.endsWith(extension))) {
      onError(
        `That file type is not supported. Choose a ${listExtensions(accept)} file.`,
      )
      return
    }

    onFile(file)
  }

  return (
    <section aria-labelledby={`${id}-label`}>
      <Label
        htmlFor={id}
        id={`${id}-label`}
        className="mb-3 block text-base font-semibold sm:text-sm"
      >
        {label}
      </Label>

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept.join(',')}
        className="sr-only"
        onChange={(event) => {
          handle(event.target.files?.[0])
          // Reset so the same file can be picked again after starting over.
          event.target.value = ''
        }}
        aria-describedby={`${id}-desc`}
      />

      <Button
        variant="outline"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault()
          dragDepth.current += 1
          setDragOver(true)
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragOver(false)
        }}
        // Only a prevented dragover marks this element as a drop target.
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(event) => {
          event.preventDefault()
          dragDepth.current = 0
          setDragOver(false)
          handle(event.dataTransfer.files?.[0])
        }}
        className={
          'w-full justify-start ' +
          (dragOver ? 'border-ring bg-accent/50 ring-2 ring-ring/40' : '')
        }
      >
        {reading ? (
          <Spinner className="size-4" />
        ) : fileName ? (
          <FileCheck2 className="size-4" aria-hidden="true" />
        ) : (
          <Upload className="size-4" aria-hidden="true" />
        )}
        <span className="truncate">
          {reading ? 'Reading...' : (fileName ?? buttonLabel)}
        </span>
      </Button>

      <p id={`${id}-desc`} className="mt-2 text-xs text-muted-foreground">
        {description}
      </p>
    </section>
  )
}
