'use client'

import { useRef, useState } from 'react'
import { FileCheck2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

interface FileSelectProps {
  id: string
  label: string
  buttonLabel: string
  accept: string[]
  fileName: string | null
  reading?: boolean
  description: string
  onFile: (file: File) => void
  onError: (message: string) => void
  multiple?: boolean
  onFiles?: ((files: File[]) => void) | undefined
}

export function listExtensions(accept: string[]): string {
  if (accept.length <= 1) return accept.join('')
  return `${accept.slice(0, -1).join(', ')} or ${accept[accept.length - 1]}`
}

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
  multiple = false,
  onFiles,
}: FileSelectProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  // dragleave fires when crossing into a child, so count enter/leave pairs.
  const dragDepth = useRef(0)
  const [dragOver, setDragOver] = useState(false)

  function handle(chosen: FileList | null | undefined) {
    const files = chosen ? Array.from(chosen) : []
    if (files.length === 0) return

    if (multiple && onFiles) {
      onFiles(files)
      return
    }

    const file = files[0] as File
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
        multiple={multiple}
        className="sr-only"
        onChange={(event) => {
          handle(event.target.files)
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
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(event) => {
          event.preventDefault()
          dragDepth.current = 0
          setDragOver(false)
          handle(event.dataTransfer.files)
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
