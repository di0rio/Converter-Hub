import {
  neutralizeFormula,
  normalizeColumns,
  type TabularTable,
} from '@sql-extractor/core'

function width(table: TabularTable): number {
  return table.rows.reduce(
    (widest, row) => Math.max(widest, row.length),
    table.columns.length,
  )
}

export function toJson(table: TabularTable): string {
  const columns = normalizeColumns(table.columns, width(table))
  const rows = table.rows.map((row) =>
    Object.fromEntries(columns.map((column, i) => [column, row[i] ?? ''])),
  )
  return JSON.stringify(rows, null, 2)
}

function markdownCell(value: string): string {
  return neutralizeFormula(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, '<br>')
}

export function toMarkdown(table: TabularTable): string {
  const columns = normalizeColumns(table.columns, width(table))
  if (columns.length === 0) return ''

  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  const lines = [
    line(columns.map(markdownCell)),
    line(columns.map(() => '---')),
    ...table.rows.map((row) =>
      line(columns.map((_, i) => markdownCell(row[i] ?? ''))),
    ),
  ]
  return `${lines.join('\n')}\n`
}
