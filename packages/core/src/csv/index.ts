import type { CsvDelimiter } from '../generator/writers.js'
import { DataFormatError } from '../records/index.js'

export type CsvParseOptions = {
  delimiter?: CsvDelimiter
}

export function parseCsv(
  text: string,
  { delimiter = ',' }: CsvParseOptions = {},
): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  const endRow = () => {
    row.push(field)
    field = ''
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }

  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const char = text[i] as string

    if (quoted) {
      if (char !== '"') field += char
      else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
    } else if (char === '"' && field === '') {
      quoted = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      endRow()
      if (char === '\r' && text[i + 1] === '\n') i++
    } else {
      field += char
    }
  }

  if (quoted) {
    throw new DataFormatError('A quoted field in this CSV never closes.')
  }
  if (field !== '' || row.length > 0) endRow()
  return rows
}

export function detectDelimiter(text: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ',': 0, ';': 0, '\t': 0 }
  let quoted = false

  for (const char of text) {
    if (char === '"') quoted = !quoted
    else if (quoted) continue
    else if (char === '\n' || char === '\r') break
    else if (char === ',' || char === ';' || char === '\t') counts[char]++
  }

  return (Object.keys(counts) as CsvDelimiter[]).reduce((best, next) =>
    counts[next] > counts[best] ? next : best,
  )
}
