'use client'

import { useRef, useState } from 'react'
import { FileCheck2, Upload } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

interface FileDropzoneProps {
  /** Unique per page: ties the label, the input and its description together. */
  id: string
  /** The step's heading, e.g. "Select a database dump". */
  label: string
  /** Extensions this tool reads, lowercase and dotted: ['.xlsx', '.csv']. */
  accept: string[]
  /** Shown under the prompt before a file is chosen, e.g. ".xlsx · .xls". */
  acceptHint: string
  /** The chosen file's name, once there is one. */
  fileName: string | null
  /** What was learned about the file — sheet count, detected engine. */
  detail: string | null
  reading?: boolean
  /** The line under the zone. Both tools use it to say nothing is uploaded. */
  description: string
  onFile: (file: File) => void
  onError: (message: string) => void
}

/** Named the way someone would read them aloud: ".xlsx, .xls or .csv". */
function listExtensions(accept: string[]): string {
  if (accept.length <= 1) return accept.join('')
  return `${accept.slice(0, -1).join(', ')} or ${accept[accept.length - 1]}`
}

/**
 * The entry point of every tool: a drop zone that is also a file picker.
 *
 * It is a real `<button>`, so the keyboard and a screen reader get the same
 * path as the mouse — drag-and-drop is the shortcut, never the only way in.
 */
export function FileDropzone({
  id,
  label,
  accept,
  acceptHint,
  fileName,
  detail,
  reading = false,
  description,
  onFile,
  onError,
}: FileDropzoneProps) {
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

      <button
        type="button"
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
          'flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl ' +
          'border-2 border-dashed px-6 py-8 text-center transition-colors duration-200 ' +
          'ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 focus-visible:ring-ring ' +
          'focus-visible:outline-none ' +
          (dragOver
            ? 'border-ring bg-accent/40'
            : fileName
              ? 'border-input bg-accent/20'
              : 'border-border bg-muted/20 hover:bg-accent/30')
        }
      >
        {reading ? (
          <Spinner className="size-5 text-muted-foreground" />
        ) : fileName ? (
          <FileCheck2
            className="size-5 text-muted-foreground"
            aria-hidden="true"
          />
        ) : (
          <Upload className="size-5 text-muted-foreground" aria-hidden="true" />
        )}

        <span className="max-w-full truncate text-sm font-medium">
          {reading
            ? 'Reading the file...'
            : (fileName ?? 'Drop a file here, or click to choose one')}
        </span>

        {!reading && (
          <span className="text-xs text-muted-foreground">
            {detail ?? acceptHint}
          </span>
        )}
      </button>

      <p id={`${id}-desc`} className="mt-2 text-xs text-muted-foreground">
        {description}
      </p>
    </section>
  )
}
