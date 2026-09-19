import {
  Braces,
  Database,
  FileCode,
  FileText,
  ImageIcon,
  Sheet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  DATA_INPUTS,
  DATA_OUTPUTS,
  IMAGE_INPUTS,
  IMAGE_OUTPUTS,
  MARKDOWN_INPUTS,
  MARKDOWN_OUTPUTS,
  formatLabels,
} from '@/lib/formats'

export interface ConverterTool {
  id: string
  name: string
  tagline: string
  description: string
  href: string
  Icon: LucideIcon
  source: string[]
  output: string[]
  heading: string
}

export const TOOLS: ConverterTool[] = [
  {
    id: 'spreadsheet',
    name: 'Spreadsheets',
    tagline: 'Split a multi-sheet workbook into one file per sheet.',
    description:
      'Split a workbook into one file per sheet, locally in your browser.',
    href: '/spreadsheet',
    Icon: Sheet,
    source: ['XLSX', 'XLSM', 'XLS', 'XLSB', 'ODS', 'CSV', 'TSV'],
    output: ['XLSX', 'CSV', 'JSON', 'Markdown', 'SQL'],
    heading: 'Split a spreadsheet',
  },
  {
    id: 'sql',
    name: 'SQL',
    tagline:
      'Extract tables from a SQL dump or a SQLite database and convert them.',
    description:
      'Extract tables from a SQL dump or a SQLite database, locally in your browser.',
    href: '/sql',
    Icon: Database,
    source: ['SQL dumps', 'SQLite databases', 'Firebird databases'],
    output: ['SQL', 'CSV', 'XLSX', 'JSON', 'JSON Lines', 'Markdown'],
    heading: 'Extract from a database',
  },
  {
    id: 'data',
    name: 'Data',
    tagline: 'Convert structured data between CSV, JSON, YAML and more.',
    description:
      'Convert one structured data file to another format, locally in your browser.',
    href: '/data',
    Icon: Braces,
    source: formatLabels(DATA_INPUTS),
    output: formatLabels(DATA_OUTPUTS),
    heading: 'Convert data',
  },
  {
    id: 'markdown',
    name: 'Markdown',
    tagline: 'Turn Markdown into an HTML file, or HTML into Markdown.',
    description:
      'Convert a Markdown document to HTML, or an HTML page to Markdown, locally in your browser.',
    href: '/markdown',
    Icon: FileText,
    source: formatLabels(MARKDOWN_INPUTS),
    output: formatLabels(MARKDOWN_OUTPUTS),
    heading: 'Convert Markdown and HTML',
  },
  {
    id: 'json-to-typescript',
    name: 'JSON to TypeScript',
    tagline: 'Write TypeScript types that describe a JSON sample.',
    description:
      'Generate TypeScript types from a JSON sample, locally in your browser.',
    href: '/json-to-typescript',
    Icon: FileCode,
    source: ['JSON'],
    output: ['TypeScript'],
    heading: 'Generate TypeScript types',
  },
  {
    id: 'image',
    name: 'Images',
    tagline: 'Convert SVG and raster images to PNG, JPEG or WebP.',
    description:
      'Convert an SVG, PNG, JPEG, WebP or AVIF image to PNG, JPEG or WebP, locally in your browser.',
    href: '/image',
    Icon: ImageIcon,
    source: formatLabels(IMAGE_INPUTS),
    output: formatLabels(IMAGE_OUTPUTS),
    heading: 'Convert an image',
  },
]

export function findTool(id: string): ConverterTool {
  const tool = TOOLS.find((candidate) => candidate.id === id)
  if (!tool) throw new Error(`Unknown tool: ${id}`)
  return tool
}

export const HUB_NAME = 'Converter Hub'

export const HUB_TAGLINE =
  'Local tools for transforming your files. Everything runs in your browser - nothing is uploaded.'
