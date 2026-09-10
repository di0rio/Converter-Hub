'use client'

import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertCircle,
  Braces,
  Database,
  FileCode,
  FileSpreadsheet,
  FileText,
  List,
  Table,
  Wand2,
} from 'lucide-react'
import {
  DataFormatError,
  formatBytes,
  type CsvDelimiter,
} from '@sql-extractor/core'
import { findTool } from '@/lib/tools'
import {
  FILE_FORMATS,
  formatExtensions,
  formatLabels,
  formatOf,
} from '@/lib/formats'
import {
  DATA_INPUTS,
  DATA_OUTPUTS,
  convertData,
  type DataFile,
  type DataInput,
  type DataOutput,
} from '@/lib/data-convert'
import { FileSelect, listExtensions } from '@/components/file-select'
import { ToolHeader } from '@/components/tool-header'
import { FormatOptions } from '@/components/format-options'
import { CsvDelimiterField } from '@/components/csv-delimiter-field'
import { DownloadStep } from '@/components/download-step'
import { Alert, AlertDescription } from '@/components/ui/alert'

const tool = findTool('data')

/**
 * A text file is held whole in memory, parsed, and written again, so the
 * ceiling is what a tab holds comfortably three times over.
 */
const MAX_DATA_BYTES = 50 * 1024 * 1024

const EXTENSIONS = formatExtensions(DATA_INPUTS)

const OUTPUT_DETAILS: Record<DataOutput, { hint: string; Icon: LucideIcon }> = {
  csv: { hint: 'Comma-separated table', Icon: Table },
  tsv: { hint: 'Tab-separated table', Icon: Table },
  json: { hint: 'Any shape, indented', Icon: Braces },
  jsonl: { hint: 'One value per line', Icon: List },
  yaml: { hint: 'Any shape', Icon: FileCode },
  markdown: { hint: 'A table in text', Icon: FileText },
  sql: { hint: 'CREATE TABLE and INSERTs', Icon: Database },
  xlsx: { hint: 'One sheet', Icon: FileSpreadsheet },
}

const OUTPUT_OPTIONS = DATA_OUTPUTS.map((id) => ({
  id,
  label: FILE_FORMATS[id].label,
  ...OUTPUT_DETAILS[id],
}))

type Loaded = { name: string; text: string; input: DataInput }

export function DataConverter() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [output, setOutput] = useState<DataOutput>('csv')
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(',')
  const [result, setResult] = useState<DataFile | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setResult(null)
    const input = formatOf(file.name, DATA_INPUTS)
    if (!input) {
      setError(
        `That file type is not supported. Choose a ${listExtensions(EXTENSIONS)} file.`,
      )
      return
    }
    if (file.size > MAX_DATA_BYTES) {
      setError(
        `That file is ${formatBytes(file.size)}. The largest this tool reads is ${formatBytes(MAX_DATA_BYTES)}.`,
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
      setResult(
        await convertData(loaded.text, loaded.input, output, loaded.name, {
          delimiter,
        }),
      )
    } catch (cause) {
      // Only messages this project wrote are shown; a parser's own message can
      // quote the file.
      setError(
        cause instanceof DataFormatError
          ? cause.message
          : `This ${FILE_FORMATS[loaded.input].label} file could not be converted.`,
      )
    } finally {
      setBusy(false)
    }
  }

  function choose(next: DataOutput) {
    setOutput(next)
    setResult(null)
  }

  function chooseDelimiter(next: CsvDelimiter) {
    setDelimiter(next)
    setResult(null)
  }

  function reset() {
    setLoaded(null)
    setResult(null)
    setError(null)
    setOutput('csv')
    setDelimiter(',')
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
          id="data-file-input"
          label="Select a data file"
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
              : `Reads ${formatLabels(DATA_INPUTS).join(', ')}.`
          } Processed entirely in your browser.`}
          onFile={(file) => void handleFile(file)}
          onError={setError}
        />

        {loaded && (
          <div className="space-y-8 motion-safe:animate-step-in">
            <div className="flex flex-col gap-4">
              <FormatOptions<DataOutput>
                id="step-format"
                label="Output format"
                options={OUTPUT_OPTIONS}
                value={output}
                onChange={choose}
              />
              {output === 'csv' && (
                <CsvDelimiterField
                  value={delimiter}
                  onChange={chooseDelimiter}
                />
              )}
            </div>

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
