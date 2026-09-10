import {
  neutralizeFormula,
  normalizeColumns,
  type TabularTable,
} from '@sql-extractor/core'

/** The widest of the header and every row, so no cell is dropped. */
function width(table: TabularTable): number {
  return table.rows.reduce(
    (widest, row) => Math.max(widest, row.length),
    table.columns.length,
  )
}

/**
 * One object per row, keyed by the header, every object with the same keys.
 *
 * Values are written exactly as read. JSON is read by programs rather than
 * reopened by a spreadsheet, so the formula prefix the CSV writer adds would
 * only corrupt the data here.
 */
export function toJson(table: TabularTable): string {
  const columns = normalizeColumns(table.columns, width(table))
  const rows = table.rows.map((row) =>
    Object.fromEntries(columns.map((column, i) => [column, row[i] ?? ''])),
  )
  return JSON.stringify(rows, null, 2)
}

/**
 * A cell that cannot break the table or the page it is rendered into: a pipe
 * would open a column, a line break would end the row, and markup would reach
 * a renderer that passes HTML through.
 */
function markdownCell(value: string): string {
  return neutralizeFormula(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, '<br>')
}

/** A GitHub-flavoured Markdown table, header first. */
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
