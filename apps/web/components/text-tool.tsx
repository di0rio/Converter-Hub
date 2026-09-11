'use client'

import { useState } from 'react'
import { AlertCircle, Copy, Download } from 'lucide-react'
import {
  CASE_STYLES,
  DataFormatError,
  formatBytes,
  convertColor,
  convertTimestamp,
  decodeBase64,
  decodeHex,
  decodeHtmlEntities,
  decodeUrl,
  encodeBase64,
  encodeHex,
  encodeHtmlEntities,
  encodeUrl,
  jsonToTypeScript,
  toCase,
  type CaseStyle,
  type TimestampRead,
} from '@sql-extractor/core'
import { findTool } from '@/lib/tools'
import { downloadFile } from '@/lib/download'
import { FileSelect, listExtensions } from '@/components/file-select'
import { ToolHeader } from '@/components/tool-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Radio, RadioGroup } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'

type Mode = { label: string; convert: (text: string) => string }

type TextToolSpec = {
  /** The label over the input box: what to paste. */
  input: string
  /** One mode means no choice to offer, so no picker is drawn. */
  modes: Mode[]
  filename: string
  type: string
  /** Extensions a file may be opened with instead of pasting, if any. */
  file?: string[]
}

/** Pasted-sized text: a sample to describe, not a data dump. */
const MAX_FILE_BYTES = 10 * 1024 * 1024

const CASE_LABELS: Record<CaseStyle, string> = {
  camel: 'camelCase',
  pascal: 'PascalCase',
  snake: 'snake_case',
  kebab: 'kebab-case',
  screaming: 'SCREAMING_SNAKE_CASE',
  dot: 'dot.case',
  title: 'Title Case',
}

const READ_AS: Record<TimestampRead, string> = {
  seconds: 'Unix seconds',
  milliseconds: 'Unix milliseconds',
  iso: 'ISO 8601',
  'iso-assumed-utc': 'ISO 8601 without an offset, read as UTC',
}

/**
 * The text tools differ only in what they call: paste text, maybe pick a
 * mode, read the result as you type. Each is one entry here.
 *
 * Only JSON to TypeScript is on the hub. Encoding, case, timestamp and color
 * are parked: their specs stay so their pages in app/_parked still build, but
 * their registry entries in lib/tools.ts are commented out.
 */
const SPECS = {
  encoding: {
    input: 'Text',
    filename: 'converted.txt',
    type: 'text/plain',
    modes: [
      { label: 'Base64 encode', convert: encodeBase64 },
      { label: 'Base64 decode', convert: decodeBase64 },
      { label: 'Hex encode', convert: encodeHex },
      { label: 'Hex decode', convert: decodeHex },
      { label: 'URL encode', convert: encodeUrl },
      { label: 'URL decode', convert: decodeUrl },
      { label: 'HTML entities encode', convert: encodeHtmlEntities },
      { label: 'HTML entities decode', convert: decodeHtmlEntities },
    ],
  },
  case: {
    input: 'Names, one per line',
    filename: 'names.txt',
    type: 'text/plain',
    modes: CASE_STYLES.map((style) => ({
      label: CASE_LABELS[style],
      convert: (text: string) => toCase(text, style),
    })),
  },
  timestamp: {
    input: 'A Unix timestamp or an ISO 8601 date',
    filename: 'timestamp.txt',
    type: 'text/plain',
    modes: [
      {
        label: 'Convert',
        convert: (text: string) => {
          const time = convertTimestamp(text)
          return [
            `Unix seconds: ${time.seconds}`,
            `Unix milliseconds: ${time.milliseconds}`,
            `ISO 8601 UTC: ${time.iso}`,
            `Read as: ${READ_AS[time.read]}`,
          ].join('\n')
        },
      },
    ],
  },
  color: {
    input: 'A color: #hex, rgb() or hsl()',
    filename: 'color.txt',
    type: 'text/plain',
    modes: [
      {
        label: 'Convert',
        convert: (text: string) => {
          const color = convertColor(text)
          return `HEX: ${color.hex}\nRGB: ${color.rgb}\nHSL: ${color.hsl}`
        },
      },
    ],
  },
  'json-to-typescript': {
    input: 'A JSON sample',
    filename: 'types.ts',
    type: 'text/typescript',
    file: ['.json'],
    modes: [
      { label: 'Convert', convert: (text: string) => jsonToTypeScript(text) },
    ],
  },
} satisfies Record<string, TextToolSpec>

export type TextToolId = keyof typeof SPECS

export function TextTool({ id }: { id: TextToolId }) {
  const tool = findTool(id)
  const spec: TextToolSpec = SPECS[id]
  const [text, setText] = useState('')
  const [modeLabel, setModeLabel] = useState(spec.modes[0]?.label ?? '')
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [source, setSource] = useState<'text' | 'file'>('text')
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  function change(next: string) {
    setText(next)
    setCopy('idle')
  }

  async function openFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setFileError(
        `That file is ${formatBytes(file.size)}. The largest this tool reads is ${formatBytes(MAX_FILE_BYTES)}.`,
      )
      return
    }
    try {
      change(await file.text())
      setFileName(file.name)
      setFileError(null)
    } catch {
      setFileError(
        'That file could not be read. It may have been moved or renamed.',
      )
    }
  }

  const mode =
    spec.modes.find((candidate) => candidate.label === modeLabel) ??
    (spec.modes[0] as Mode)

  // Converted on every render: every conversion here is a pass over the text,
  // far cheaper than the render itself.
  let output = ''
  let error: string | null = null
  if (text) {
    try {
      output = mode.convert(text)
    } catch (caught) {
      // Only our own messages are shown: anything else could quote the input.
      error =
        caught instanceof DataFormatError
          ? caught.message
          : 'This text could not be converted.'
    }
  }

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(output)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  return (
    <div className="w-full max-w-2xl space-y-8">
      <ToolHeader tool={tool} />

      {spec.modes.length > 1 && (
        <RadioGroup
          aria-label="Mode"
          value={mode.label}
          onValueChange={(next) => {
            setModeLabel(next as string)
            setCopy('idle')
          }}
          className="flex-row flex-wrap gap-x-5 gap-y-2"
        >
          {spec.modes.map((option) => (
            <Label key={option.label}>
              <Radio value={option.label} />
              {option.label}
            </Label>
          ))}
        </RadioGroup>
      )}

      {spec.file && (
        <RadioGroup
          aria-label="Source"
          value={source}
          onValueChange={(next) => {
            setSource(next as 'text' | 'file')
            setFileName(null)
            setFileError(null)
            change('')
          }}
          className="flex-row flex-wrap gap-x-5 gap-y-2"
        >
          <Label>
            <Radio value="text" />
            Paste text
          </Label>
          <Label>
            <Radio value="file" />
            Open a file
          </Label>
        </RadioGroup>
      )}

      {source === 'file' && spec.file ? (
        <FileSelect
          id={`${id}-file`}
          label="Select a file"
          buttonLabel="Choose file"
          accept={spec.file}
          fileName={fileName}
          description={`Reads ${listExtensions(spec.file)}. Processed entirely in your browser.`}
          onFile={(file) => void openFile(file)}
          onError={setFileError}
        />
      ) : (
        <div className="space-y-2">
          <Label htmlFor={`${id}-input`}>{spec.input}</Label>
          <Textarea
            id={`${id}-input`}
            className="font-mono"
            value={text}
            spellCheck={false}
            onChange={(event) => change(event.target.value)}
          />
        </div>
      )}

      {(fileError ?? error) && (
        <Alert variant="error">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{fileError ?? error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor={`${id}-output`}>Output</Label>
        <Textarea
          id={`${id}-output`}
          className="font-mono"
          value={output}
          readOnly
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={!output}
            onClick={() => void copyOutput()}
          >
            <Copy aria-hidden="true" />
            {copy === 'copied' ? 'Copied' : 'Copy'}
          </Button>
          <Button
            variant="outline"
            disabled={!output}
            onClick={() => downloadFile(output, spec.filename, spec.type)}
          >
            <Download aria-hidden="true" />
            Download {spec.filename}
          </Button>
        </div>
        {copy === 'failed' && (
          <p className="text-sm text-muted-foreground">
            The browser blocked the clipboard. Select the output and copy it
            instead.
          </p>
        )}
      </div>
    </div>
  )
}
