import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DATABASE_FORMATS, allFormats } from '@sql-extractor/core'
import { FormatCaveat } from '@/components/format-caveat'

describe('FormatCaveat', () => {
  it('warns before export when the source cannot be fully represented', () => {
    render(<FormatCaveat sourceFormat={DATABASE_FORMATS.neo4j} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/Neo4j: not everything converts/)
    expect(alert).toHaveTextContent(/relationships are not/i)
  })

  it('says nothing for a format that loses nothing', () => {
    // MySQL carries no caveat, so a warning here would be noise that teaches
    // people to dismiss the one that matters.
    render(<FormatCaveat sourceFormat={DATABASE_FORMATS.mysql} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says nothing for a format whose note is merely informative', () => {
    // Cassandra documents what it does not read, but nothing is lost from
    // what it does read.
    expect(DATABASE_FORMATS.cassandra.note).toBeTruthy()
    expect(DATABASE_FORMATS.cassandra.lossy).toBeUndefined()

    render(<FormatCaveat sourceFormat={DATABASE_FORMATS.cassandra} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says nothing before a file is loaded', () => {
    render(<FormatCaveat sourceFormat={null} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the catalog note verbatim for every lossy format', () => {
    // The warning text is the catalog's, so it cannot drift from the docs.
    for (const format of allFormats().filter((f) => f.lossy === true)) {
      const { unmount } = render(<FormatCaveat sourceFormat={format} />)
      expect(screen.getByRole('alert')).toHaveTextContent(format.note as string)
      unmount()
    }
  })
})
