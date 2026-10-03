import { DATA_INPUTS, IMAGE_INPUTS, MARKDOWN_INPUTS, formatExtensions } from '@/lib/formats'
import { ACCEPTED_EXTENSIONS as SPREADSHEET_EXTENSIONS } from '@/lib/spreadsheet'
import { SQL_TOOL_EXTENSIONS } from '@/lib/sqlite-files'
import { TOOLS, type ConverterTool } from '@/lib/tools'

/*
 * Drop any file on the home page: the hub picks the tool by extension, keeps the file here in
 * memory and navigates. The tool's file selector takes the pending file when it mounts.
 * Nothing leaves the browser.
 */

let pending: File | null = null

// Order matters: CSV/TSV open in the data converter (the spreadsheet tool reads them too, but it is meant for workbooks).
const ROUTES: { id: string; extensions: readonly string[] }[] = [
  { id: 'data', extensions: formatExtensions(DATA_INPUTS) },
  { id: 'spreadsheet', extensions: SPREADSHEET_EXTENSIONS },
  { id: 'sql', extensions: SQL_TOOL_EXTENSIONS },
  { id: 'markdown', extensions: formatExtensions(MARKDOWN_INPUTS) },
  { id: 'image', extensions: formatExtensions(IMAGE_INPUTS) },
]

export function toolForFile(name: string): ConverterTool | null {
  const lower = name.toLowerCase()
  const route = ROUTES.find((r) => r.extensions.some((extension) => lower.endsWith(extension)))
  return route ? (TOOLS.find((t) => t.id === route.id) ?? null) : null
}

export function setPendingFile(file: File): void {
  pending = file
}

/** Hands the pending file over once, and only to a tool that accepts its extension. */
export function takePendingFile(accept: readonly string[]): File | null {
  if (!pending) return null
  const name = pending.name.toLowerCase()
  if (!accept.some((extension) => name.endsWith(extension))) return null
  const file = pending
  pending = null
  return file
}

/** Every extension the home page accepts (for its file input). */
export const ALL_EXTENSIONS = [...new Set(ROUTES.flatMap((r) => r.extensions))]
