import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UnreadableTables } from '@/components/unreadable-tables'

describe('UnreadableTables', () => {
  it('names each refused table with a plain reason', () => {
    render(
      <UnreadableTables
        tables={[
          {
            name: 'orders',
            reason: 'compressed',
            detail: 'cmprlevel 2',
          },
          { name: 'audit', reason: 'damaged', detail: 'page 812: bad slot' },
          { name: 'scratch', reason: 'temporary' },
        ]}
        readableCount={4}
      />,
    )

    const note = screen.getByRole('status')
    expect(note).toHaveTextContent('3 tables could not be read')
    expect(note).toHaveTextContent('orders uses row or page compression')
    expect(note).toHaveTextContent('audit could not be decoded')
    expect(note).toHaveTextContent(/left out of the list and the export/)
    expect(note).toHaveTextContent(/scratch is a temporary table/)
    expect(note).not.toHaveTextContent(/cmprlevel|page 812/)
  })

  it('says when nothing is left to export', () => {
    render(
      <UnreadableTables
        tables={[{ name: 'grid', reason: 'array' }]}
        readableCount={0}
      />,
    )
    const note = screen.getByRole('status')
    expect(note).toHaveTextContent('1 table could not be read')
    expect(note).toHaveTextContent('Nothing in this file can be exported.')
  })

  it('says nothing when every table was read', () => {
    render(<UnreadableTables tables={[]} readableCount={2} />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
