'use client'

import { useState } from 'react'
import { AlertCircle, FileImage, Wand2 } from 'lucide-react'
import { DataFormatError, formatBytes, toFileName } from '@sql-extractor/core'
import { findTool } from '@/lib/tools'
import {
  FILE_FORMATS,
  IMAGE_INPUTS,
  IMAGE_OUTPUTS,
  formatExtensions,
  formatLabels,
  formatOf,
} from '@/lib/formats'
import { convertImage, type ImageInput, type ImageOutput } from '@/lib/image'
import { FileSelect, listExtensions } from '@/components/file-select'
import { ToolHeader } from '@/components/tool-header'
import { FormatOptions } from '@/components/format-options'
import { DownloadStep } from '@/components/download-step'
import { Alert, AlertDescription } from '@/components/ui/alert'

const tool = findTool('image')

/** A decoded image takes four bytes a pixel, far more than the file. */
const MAX_IMAGE_BYTES = 50 * 1024 * 1024

const EXTENSIONS = formatExtensions(IMAGE_INPUTS)

const HINTS: Record<ImageOutput, string> = {
  png: 'Lossless, keeps transparency',
  jpeg: 'Smaller, on a white background',
  webp: 'Smaller, keeps transparency',
}

const OUTPUT_OPTIONS = IMAGE_OUTPUTS.map((id) => ({
  id,
  label: FILE_FORMATS[id].label,
  hint: HINTS[id],
  Icon: FileImage,
}))

type Loaded = { name: string; file: File; input: ImageInput }
type Result = { filename: string; bytes: Uint8Array; type: string }

export function ImageConverter() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [output, setOutput] = useState<ImageOutput>('png')
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleFile(file: File) {
    setResult(null)
    const input = formatOf(file.name, IMAGE_INPUTS)
    if (!input) {
      setError(
        `That file type is not supported. Choose a ${listExtensions(EXTENSIONS)} file.`,
      )
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(
        `That file is ${formatBytes(file.size)}. The largest this tool reads is ${formatBytes(MAX_IMAGE_BYTES)}.`,
      )
      return
    }
    setLoaded({ name: file.name.replace(/\.[^.]+$/, ''), file, input })
    setError(null)
  }

  async function convert() {
    if (!loaded) return
    setBusy(true)
    setError(null)
    try {
      const format = FILE_FORMATS[output]
      setResult({
        filename: `${toFileName(loaded.name, 'image')}${format.extensions[0]}`,
        bytes: await convertImage(loaded.file, loaded.input, output),
        type: format.type,
      })
    } catch (cause) {
      // Only messages this project wrote are shown.
      setError(
        cause instanceof DataFormatError
          ? cause.message
          : `This ${FILE_FORMATS[loaded.input].label} image could not be converted.`,
      )
    } finally {
      setBusy(false)
    }
  }

  function choose(next: ImageOutput) {
    setOutput(next)
    setResult(null)
  }

  function reset() {
    setLoaded(null)
    setResult(null)
    setError(null)
    setOutput('png')
  }

  return (
    <div className="w-full max-w-lg space-y-8">
      <ToolHeader tool={tool} />

      {error && (
        <Alert variant="error" className="motion-safe:animate-step-in">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-8">
        <FileSelect
          id="image-file-input"
          label="Select an image"
          buttonLabel="Choose file"
          accept={EXTENSIONS}
          fileName={
            loaded
              ? `${loaded.name}${FILE_FORMATS[loaded.input].extensions[0]}`
              : null
          }
          description={`${
            loaded
              ? `Read as ${FILE_FORMATS[loaded.input].label}.`
              : `Reads ${formatLabels(IMAGE_INPUTS).join(', ')}.`
          } Processed entirely in your browser.`}
          onFile={handleFile}
          onError={setError}
        />

        {loaded && (
          <div className="space-y-8 motion-safe:animate-step-in">
            <FormatOptions<ImageOutput>
              id="step-format"
              label="Output format"
              options={OUTPUT_OPTIONS}
              value={output}
              onChange={choose}
            />

            <DownloadStep
              id="step-download"
              label="Convert and download"
              pending={`Ready to convert to ${FILE_FORMATS[output].label}.`}
              actionLabel="Convert"
              actionIcon={Wand2}
              busyLabel="Converting..."
              busy={busy}
              result={result}
              facts={
                result
                  ? [
                      { label: 'File', value: result.filename },
                      {
                        label: 'Size',
                        value: formatBytes(result.bytes.byteLength),
                      },
                    ]
                  : []
              }
              onRun={() => void convert()}
              onReset={reset}
              onError={setError}
            />
          </div>
        )}
      </div>
    </div>
  )
}
