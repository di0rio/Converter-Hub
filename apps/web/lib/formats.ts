/**
 * File formats the general-purpose tools read and write.
 *
 * Metadata only: a name to show, the extensions a file arrives with, and the
 * MIME type a download goes out as. How a format is read or written lives with
 * the tool that does it, so this stays a table rather than a framework.
 *
 * The SQL tool's database formats are not here: they carry dialect semantics
 * and have their own catalog in `packages/core/src/formats`.
 */
export type FileFormat = {
  label: string
  extensions: readonly string[]
  type: string
}

export const FILE_FORMATS = {
  csv: { label: 'CSV', extensions: ['.csv'], type: 'text/csv' },
  tsv: {
    label: 'TSV',
    extensions: ['.tsv'],
    type: 'text/tab-separated-values',
  },
  json: { label: 'JSON', extensions: ['.json'], type: 'application/json' },
  jsonl: {
    label: 'JSON Lines',
    extensions: ['.jsonl', '.ndjson'],
    type: 'application/x-ndjson',
  },
  yaml: {
    label: 'YAML',
    extensions: ['.yaml', '.yml'],
    type: 'application/yaml',
  },
  markdown: { label: 'Markdown', extensions: ['.md'], type: 'text/markdown' },
  sql: { label: 'SQL', extensions: ['.sql'], type: 'application/sql' },
  xlsx: {
    label: 'XLSX',
    extensions: ['.xlsx'],
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
} as const satisfies Record<string, FileFormat>

export type FormatId = keyof typeof FILE_FORMATS

/** What the data tool reads, and what it writes. The card derives from these. */
export const DATA_INPUTS = ['csv', 'tsv', 'json', 'jsonl', 'yaml'] as const
export const DATA_OUTPUTS = [
  'csv',
  'tsv',
  'json',
  'jsonl',
  'yaml',
  'markdown',
  'sql',
  'xlsx',
] as const

export function formatLabels(ids: readonly FormatId[]): string[] {
  return ids.map((id) => FILE_FORMATS[id].label)
}

export function formatExtensions(ids: readonly FormatId[]): string[] {
  return ids.flatMap((id) => FILE_FORMATS[id].extensions)
}

/** The format among `ids` that a file name's extension names, if any. */
export function formatOf<T extends FormatId>(
  name: string,
  ids: readonly T[],
): T | null {
  const lower = name.toLowerCase()
  return (
    ids.find((id) =>
      FILE_FORMATS[id].extensions.some((extension) =>
        lower.endsWith(extension),
      ),
    ) ?? null
  )
}
