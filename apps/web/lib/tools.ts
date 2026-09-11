// Binary, CaseSensitive, Clock and Palette are the parked tools' icons; see
// the commented entries at the end of TOOLS.
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

/**
 * One converter in the hub.
 *
 * A tool is described once, here, and the same entry drives the hub cards, the
 * page titles, the breadcrumbs and the route metadata. Adding a third tool is
 * an entry plus a route, with nothing to keep in sync by hand.
 *
 * `source` and `output` are kept apart on purpose: what a tool reads and what
 * it writes are different questions, and a future converter will pair them
 * differently again.
 */
export interface ConverterTool {
  id: string
  /** The tool's own name, used as the page title and the card heading. */
  name: string
  /** One line for the hub card. */
  tagline: string
  /** The sentence under the heading inside the tool. */
  description: string
  href: string
  Icon: LucideIcon
  /** What the tool reads, named the way a file manager names it. */
  source: string[]
  /** What it writes. */
  output: string[]
  /** The h1 inside the tool: what you are about to do, as a phrase. */
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
  // Parked: built and tested, but kept off the hub for now. To bring one
  // back, uncomment its entry and its icon import, and move its page from
  // app/_parked/<id> to app/<id>. See app/_parked/README.md.
  //
  // {
  //   id: 'encoding',
  //   name: 'Encoding',
  //   tagline: 'Encode or decode Base64, hex, URL encoding and HTML entities.',
  //   description:
  //     'Encode text as Base64, hex, URL encoding or HTML entities, or decode it, locally in your browser.',
  //   href: '/encoding',
  //   Icon: Binary,
  //   source: ['Text', 'Base64', 'Hex', 'URL encoding', 'HTML entities'],
  //   output: ['Text', 'Base64', 'Hex', 'URL encoding', 'HTML entities'],
  //   heading: 'Encode and decode text',
  // },
  // {
  //   id: 'case',
  //   name: 'Case',
  //   tagline: 'Rename identifiers between camelCase, snake_case and more.',
  //   description:
  //     'Convert names between identifier styles, one per line, locally in your browser.',
  //   href: '/case',
  //   Icon: CaseSensitive,
  //   source: ['Text'],
  //   output: [
  //     'camelCase',
  //     'PascalCase',
  //     'snake_case',
  //     'kebab-case',
  //     'SCREAMING_SNAKE_CASE',
  //     'dot.case',
  //     'Title Case',
  //   ],
  //   heading: 'Change case',
  // },
  // {
  //   id: 'timestamp',
  //   name: 'Timestamps',
  //   tagline: 'Read a Unix timestamp or an ISO 8601 date in every form.',
  //   description:
  //     'Convert between Unix seconds, Unix milliseconds and ISO 8601, in UTC, locally in your browser.',
  //   href: '/timestamp',
  //   Icon: Clock,
  //   source: ['Unix seconds', 'Unix milliseconds', 'ISO 8601'],
  //   output: ['Unix seconds', 'Unix milliseconds', 'ISO 8601 UTC'],
  //   heading: 'Convert a timestamp',
  // },
  // {
  //   id: 'color',
  //   name: 'Colors',
  //   tagline: 'Convert a color between HEX, rgb() and hsl().',
  //   description:
  //     'Convert a color between HEX, rgb() and hsl(), locally in your browser.',
  //   href: '/color',
  //   Icon: Palette,
  //   source: ['HEX', 'RGB', 'HSL'],
  //   output: ['HEX', 'RGB', 'HSL'],
  //   heading: 'Convert a color',
  // },
]

export function findTool(id: string): ConverterTool {
  const tool = TOOLS.find((candidate) => candidate.id === id)
  // A missing id is a wiring mistake in this repo, not a user input, so it
  // fails loudly at the call site rather than rendering an empty page.
  if (!tool) throw new Error(`Unknown tool: ${id}`)
  return tool
}

export const HUB_NAME = 'Converter Hub'

export const HUB_TAGLINE =
  'Local tools for transforming your files. Everything runs in your browser — nothing is uploaded.'
