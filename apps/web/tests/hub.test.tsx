import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Hub } from '@/components/hub'
import { setPendingFile, takePendingFile, toolForFile } from '@/lib/handoff'
import { TOOLS } from '@/lib/tools'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

function dropOnHome(file: File) {
  const zone = screen.getByText('Drop any file here').parentElement as HTMLElement
  fireEvent.drop(zone, { dataTransfer: { files: [file], dropEffect: 'copy' } })
}

describe('Hub', () => {
  beforeEach(() => push.mockClear())

  it('says what it does before anything else', () => {
    render(<Hub />)

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'convert files without sending them anywhere.',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'tools' }),
    ).toBeInTheDocument()
  })

  it('lists one row per registered tool, and nothing else', () => {
    render(<Hub />)

    const rows = within(
      screen.getByRole('region', { name: 'tools' }),
    ).getAllByRole('link')

    expect(rows).toHaveLength(TOOLS.length)
    for (const [index, tool] of TOOLS.entries()) {
      expect(rows[index]).toHaveAttribute('href', tool.href)
      expect(rows[index]).toHaveTextContent(tool.name)
      expect(rows[index]).toHaveTextContent(tool.tagline)
    }
  })

  it('keeps what a tool reads apart from what it writes', () => {
    render(<Hub />)

    const sql = screen.getByRole('link', { name: /^SQL/ })
    expect(sql).toHaveTextContent('SQL dumps · SQLite databases')
    expect(sql).toHaveTextContent(
      '→ SQL · CSV · XLSX · JSON · JSON Lines · Markdown',
    )

    const spreadsheet = screen.getByRole('link', { name: /^Spreadsheets/ })
    expect(spreadsheet).toHaveTextContent('→ XLSX · CSV · JSON · Markdown · SQL')
  })

  it('makes the whole row the target, so there is one stop per tool', () => {
    render(<Hub />)

    expect(
      within(screen.getByRole('region', { name: 'tools' })).queryAllByRole(
        'button',
      ),
    ).toHaveLength(0)
  })

  it('says where the work happens, on the page and not only in the docs', () => {
    render(<Hub />)

    expect(screen.getByText('nothing is uploaded')).toBeInTheDocument()
    expect(screen.getByText(/never leaves this tab/i)).toBeInTheDocument()
    expect(
      screen.getByText(/no SQL from your files is ever executed/i),
    ).toBeInTheDocument()
  })

  it('opens the right tool with a dropped file already in it', () => {
    render(<Hub />)

    const file = new File(['id,name\n1,Ana'], 'people.csv', { type: 'text/csv' })
    dropOnHome(file)

    expect(push).toHaveBeenCalledWith('/data')
    expect(takePendingFile(['.csv'])).toBe(file)
    // Handed over once only.
    expect(takePendingFile(['.csv'])).toBeNull()
  })

  it('says so, and stays put, when no tool reads the file', () => {
    render(<Hub />)

    dropOnHome(new File(['x'], 'movie.mp4'))

    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No tool reads MP4 files yet',
    )
  })
})

describe('toolForFile', () => {
  it.each([
    ['people.csv', 'data'],
    ['report.xlsx', 'spreadsheet'],
    ['dump.sql', 'sql'],
    ['README.md', 'markdown'],
    ['logo.svg', 'image'],
  ])('sends %s to the %s tool', (name, id) => {
    expect(toolForFile(name)?.id).toBe(id)
  })

  it('has no tool for files nothing reads', () => {
    expect(toolForFile('movie.mp4')).toBeNull()
  })
})

describe('takePendingFile', () => {
  it('keeps the file for a tool that cannot read it', () => {
    const file = new File(['<svg/>'], 'logo.svg')
    setPendingFile(file)

    expect(takePendingFile(['.csv'])).toBeNull()
    expect(takePendingFile(['.svg'])).toBe(file)
  })
})
