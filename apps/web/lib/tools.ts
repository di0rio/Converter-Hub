import { Database, Sheet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

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
    source: ['XLSX', 'XLSM', 'XLS'],
    output: ['XLSX', 'CSV'],
    heading: 'Split a spreadsheet',
  },
  {
    id: 'sql',
    name: 'SQL',
    tagline: 'Extract tables from a database dump and convert them.',
    description:
      'Extract tables from a database dump, locally in your browser.',
    href: '/sql',
    Icon: Database,
    source: ['SQL dumps'],
    output: ['SQL', 'CSV', 'XLSX'],
    heading: 'Extract from a SQL dump',
  },
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
