'use client'

import { useState } from 'react'
import { AlertCircle, Wand2 } from 'lucide-react'
import { formatBytes, toFileName } from '@sql-extractor/core'
import { findTool } from '@/lib/tools'
import {
  FILE_FORMATS,
  MARKDOWN_INPUTS,
  formatExtensions,
  formatOf,
} from '@/lib/formats'
import { htmlToMarkdown, markdownToHtml } from '@/lib/markdown'
import { FileSelect, listExtensions } from '@/components/file-select'
import { ToolHeader } from '@/components/tool-header'
import { DownloadStep } from '@/components/download-step'
import { Alert, AlertDescription } from '@/components/ui/alert'

const tool = findTool('markdown')

/** A document, not a data dump: this is far past any real one. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

const EXTENSIONS = formatExtensions(MARKDOWN_INPUTS)

type Input = (typeof MARKDOWN_INPUTS)[number]
type Loaded = { name: string; text: string; input: Input }
type Result = { filename: string; bytes: Uint8Array; type: string }

/** Each input has one output: Markdown becomes HTML, HTML becomes Markdown. */
const OUTPUT_OF = { markdown: 'html', html: 'markdown' } as const

export function MarkdownConverter() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setResult(null)
    const input = formatOf(file.name, MARKDOWN_INPUTS)
    if (!input) {
      setError(
        `That file type is not supported. Choose a ${listExtensions(EXTENSIONS)} file.`,
      )
      return
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError(
        `That file is ${formatBytes(file.size)}. The largest this tool reads is ${formatBytes(MAX_DOCUMENT_BYTES)}.`,
      )
      return
    }

    try {
      const text = await file.text()
      setLoaded({ name: file.name.replace(/\.[^.]+$/, ''), text, input })
      setError(null)
    } catch {
      setError(
        'That file could not be read. It may have been moved or renamed.',
      )
    }
  }

  async function convert() {
    if (!loaded) return
    setBusy(true)
    setError(null)
    try {
      const output = FILE_FORMATS[OUTPUT_OF[loaded.input]]
      const content =
        loaded.input === 'markdown'
          ? await markdownToHtml(loaded.text, loaded.name)
          : htmlToMarkdown(loaded.text)
      setResult({
        filename: `${toFileName(loaded.name, 'document')}${output.extensions[0]}`,
        bytes: new TextEncoder().encode(content),
        type: output.type,
      })
    } catch {
      setError(
        `This ${FILE_FORMATS[loaded.input].label} file could not be converted.`,
      )
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setLoaded(null)
    setResult(null)
    setError(null)
  }

  const outputLabel = loaded ? FILE_FORMATS[OUTPUT_OF[loaded.input]].label : ''

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
          id="markdown-file-input"
          label="Select a Markdown or HTML file"
          buttonLabel="Choose file"
          accept={EXTENSIONS}
          fileName={
            loaded
              ? `${loaded.name}${FILE_FORMATS[loaded.input].extensions[0]}`
              : null
          }
          description={`${
            loaded
              ? `Read as ${FILE_FORMATS[loaded.input].label}. Converts to ${outputLabel}.`
              : 'Markdown becomes an HTML file; HTML becomes Markdown.'
          } Processed entirely in your browser.`}
          onFile={(file) => void handleFile(file)}
          onError={setError}
        />

        {loaded && (
          <div className="motion-safe:animate-step-in">
            <DownloadStep
              id="step-download"
              label="Convert and download"
              pending={`Ready to convert to ${outputLabel}.`}
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
