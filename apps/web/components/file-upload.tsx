'use client'

import { useRef } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

interface FileUploadProps {
  onFile: (content: string, name: string) => void
  fileName: string | null
}

export function FileUpload({ onFile, fileName }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    file.text().then((content) => {
      onFile(content, file.name)
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
        Select SQL file
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
        MySQL or MariaDB dump file. Processed entirely in your browser.
      </p>
    </section>
  )
}
