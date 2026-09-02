import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { parseSqlDump } from '@sql-extractor/core'
import { TableViewer } from '@/components/table-viewer'

// Synthetic fixture — no real data.
const DUMP = [
  'CREATE TABLE `users` (',
  '  `id` int NOT NULL,',
  '  `name` varchar(100),',
  '  `note` text',
  ');',
  "INSERT INTO `users` VALUES (1,'Ana',NULL),(2,'Bruno, Jr.','ok');",
  'CREATE TABLE `empty_table` (`id` int NOT NULL);',
].join('\n')

const database = parseSqlDump(DUMP).databases[0]
const users = database.tables[0]
const emptyTable = database.tables[1]

describe('TableViewer', () => {
  it('renders the table name and its row count', () => {
    render(<TableViewer table={users} />)
    expect(screen.getByText(/users/)).toBeInTheDocument()
    expect(screen.getByText(/2 rows/)).toBeInTheDocument()
  })

  it('renders column headers from the parsed table', () => {
    render(<TableViewer table={users} />)
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['#', 'id', 'name', 'note'])
  })

  it('renders row values with numbering', () => {
    render(<TableViewer table={users} />)
    const rows = screen.getAllByRole('row')

    // Header plus two data rows.
    expect(rows).toHaveLength(3)
    expect(within(rows[1]).getByText('Ana')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Bruno, Jr.')).toBeInTheDocument()

    // First cell of each row is its number, independent of the id column.
    expect(rows[1].querySelector('td')?.textContent).toBe('1')
    expect(rows[2].querySelector('td')?.textContent).toBe('2')
  })

  it('shows NULL as a marker rather than an empty cell', () => {
    render(<TableViewer table={users} />)
    expect(screen.getByText('NULL')).toBeInTheDocument()
  })

  it('states plainly when a table has no rows', () => {
    render(<TableViewer table={emptyTable} />)
    expect(screen.getByText(/no data rows/i)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('renders values as text, never as markup', () => {
    const hostile = parseSqlDump(
      [
        'CREATE TABLE `t` (`id` int NOT NULL, `payload` text);',
        "INSERT INTO `t` VALUES (1,'<img src=x onerror=alert(1)>');",
      ].join('\n'),
    ).databases[0].tables[0]

    const { container } = render(<TableViewer table={hostile} />)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
  })

  it('keeps wide content inside its own scroll container', () => {
    const { container } = render(<TableViewer table={users} />)
    const pane = container.querySelector('.overflow-auto')

    expect(pane).not.toBeNull()
    // Scrolling stays available; only the scrollbar chrome is hidden.
    expect(pane).toHaveClass('no-scrollbar')
  })

  it('does not render every row for a large table', () => {
    const values = Array.from({ length: 5000 }, (_, i) => `(${i + 1},'n${i}','x')`).join(',')
    const big = parseSqlDump(
      [
        'CREATE TABLE `big` (`id` int NOT NULL, `name` varchar(50), `note` text);',
        `INSERT INTO \`big\` VALUES ${values};`,
      ].join('\n'),
    ).databases[0].tables[0]

    render(<TableViewer table={big} />)

    expect(screen.getByText(/5,000 rows/)).toBeInTheDocument()
    // Header + a window of rows + two spacer rows, nowhere near 5000.
    expect(screen.getAllByRole('row').length).toBeLessThan(60)
  })
})
