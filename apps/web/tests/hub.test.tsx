import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { Hub } from '@/components/hub'
import { TOOLS } from '@/lib/tools'

describe('Hub', () => {
  it('asks what you want to do before anything else', () => {
    render(<Hub />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Converter Hub' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Tools' }),
    ).toBeInTheDocument()
  })

  it('shows one card per registered tool, and nothing else', () => {
    render(<Hub />)

    const cards = within(
      screen.getByRole('region', { name: 'Tools' }),
    ).getAllByRole('link')

    expect(cards).toHaveLength(TOOLS.length)
    for (const [index, tool] of TOOLS.entries()) {
      expect(cards[index]).toHaveAttribute('href', tool.href)
      expect(cards[index]).toHaveTextContent(tool.name)
      expect(cards[index]).toHaveTextContent(tool.tagline)
    }
  })

  it('keeps what a tool reads apart from what it writes', () => {
    render(<Hub />)

    // Anchored: the spreadsheet card names SQL among its outputs too.
    const sql = screen.getByRole('link', { name: /^SQL/ })
    expect(sql).toHaveTextContent('SQL dumps, SQLite databases')
    expect(sql).toHaveTextContent('SQL, CSV, XLSX, JSON, JSON Lines, Markdown')

    const spreadsheet = screen.getByRole('link', { name: /^Spreadsheets/ })
    expect(spreadsheet).toHaveTextContent('XLSX, CSV, JSON, Markdown, SQL')
  })

  it('makes the whole card the target, so there is one stop per tool', () => {
    render(<Hub />)

    // A button inside a link would leave one tab stop that does nothing.
    expect(
      within(screen.getByRole('region', { name: 'Tools' })).queryAllByRole(
        'button',
      ),
    ).toHaveLength(0)
  })

  it('says where the work happens, on the page and not only in the docs', () => {
    render(<Hub />)

    expect(screen.getByText(/nothing is uploaded/i)).toBeInTheDocument()
    expect(screen.getByText(/never leaves this tab/i)).toBeInTheDocument()
    expect(screen.getByText(/no SQL is ever executed/i)).toBeInTheDocument()
  })
})
