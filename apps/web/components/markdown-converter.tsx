'use client'

import { useState } from 'react'
import { AlertCircle, FileCode, FileText, Wand2 } from 'lucide-react'
import { formatBytes, toFileName } from '@sql-extractor/core'
import { findTool } from '@/lib/tools'
import { FILE_FORMATS, type MARKDOWN_INPUTS, formatOf } from '@/lib/formats'
import { htmlToMarkdown, markdownToHtml } from '@/lib/markdown'
import { FileSelect, listExtensions } from '@/components/file-select'
import { FormatOptions } from '@/components/format-options'
import { ToolHeader } from '@/components/tool-header'
import { DownloadStep } from '@/components/download-step'
import { Alert, AlertDescription } from '@/components/ui/alert'

const tool = findTool('markdown')

/** A document, not a data dump: this is far past any real one. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

type Input = (typeof MARKDOWN_INPUTS)[number]
type Loaded = { name: string; text: string }
type Result = { filename: string; bytes: Uint8Array; type: string }

/** Each input has one output: Markdown becomes HTML, HTML becomes Markdown. */
const OUTPUT_OF = { markdown: 'html', html: 'markdown' } as const

const DIRECTIONS = [
  {
    id: 'markdown' as const,
    label: 'Markdown to HTML',
    hint: 'A .md file becomes a web page',
    Icon: FileText,
  },
  {
    id: 'html' as const,
    label: 'HTML to Markdown',
    hint: 'A .html file becomes Markdown',
    Icon: FileCode,
  },
]

export function MarkdownConverter() {
  const [input, setInput] = useState<Input>('markdown')
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inputFormat = FILE_FORMATS[input]
  const outputFormat = FILE_FORMATS[OUTPUT_OF[input]]
  const extensions = [...inputFormat.extensions]

  async function handleFile(file: File) {
    setResult(null)
    if (!formatOf(file.name, [input])) {
      setError(
        `That file type is not supported. Choose a ${listExtensions(extensions)} file.`,
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
      setLoaded({ name: file.name.replace(/\.[^.]+$/, ''), text })
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
      const content =
        input === 'markdown'
          ? await markdownToHtml(loaded.text, loaded.name)
          : htmlToMarkdown(loaded.text)
      setResult({
        filename: `${toFileName(loaded.name, 'document')}${outputFormat.extensions[0]}`,
        bytes: new TextEncoder().encode(content),
        type: outputFormat.type,
      })
    } catch {
      setError(`This ${inputFormat.label} file could not be converted.`)
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setLoaded(null)
    setResult(null)
    setError(null)
  }

  function choose(next: Input) {
    setInput(next)
    reset()
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
        <FormatOptions<Input>
          id="step-direction"
          label="Conversion"
          options={DIRECTIONS}
          value={input}
          onChange={choose}
        />

        <FileSelect
          id="markdown-file-input"
          label={`Select a ${inputFormat.label} file`}
          buttonLabel="Choose file"
          accept={extensions}
          fileName={
            loaded ? `${loaded.name}${inputFormat.extensions[0]}` : null
          }
          description={`Reads ${listExtensions(extensions)}. Processed entirely in your browser.`}
          onFile={(file) => void handleFile(file)}
          onError={setError}
        />

        {loaded && (
          <div className="motion-safe:animate-step-in">
            <DownloadStep
              id="step-download"
              label="Convert and download"
              pending={`Ready to convert to ${outputFormat.label}.`}
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
