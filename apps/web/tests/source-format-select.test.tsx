import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SUPPORTED_FORMATS, formatsWithStatus } from '@sql-extractor/core'
import { SourceFormatSelect } from '@/components/source-format-select'

describe('SourceFormatSelect', () => {
  it('offers auto-detect plus every supported format', () => {
    render(<SourceFormatSelect value={null} onChange={vi.fn()} confidence={null} />)

    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options[0]).toBe('Auto-detect')
    expect(options.slice(1)).toEqual(SUPPORTED_FORMATS.map((f) => f.label))
  })

  it('never offers a format the project cannot read', () => {
    render(<SourceFormatSelect value={null} onChange={vi.fn()} confidence={null} />)

    const options = screen.getAllByRole('option').map((o) => o.textContent)
    for (const planned of formatsWithStatus('planned')) {
      expect(options).not.toContain(planned.label)
    }
    for (const unusable of formatsWithStatus('not_applicable')) {
      expect(options).not.toContain(unusable.label)
    }
  })

  it('shows auto-detect while no engine is pinned', () => {
    render(<SourceFormatSelect value={null} onChange={vi.fn()} confidence={null} />)
    expect(screen.getByLabelText('Read as')).toHaveValue('auto')
  })

  it('shows the pinned engine when one is chosen', () => {
    render(<SourceFormatSelect value="postgresql" onChange={vi.fn()} confidence={null} />)
    expect(screen.getByLabelText('Read as')).toHaveValue('postgresql')
  })

  it('reports the chosen engine', () => {
    const onChange = vi.fn()
    render(<SourceFormatSelect value={null} onChange={onChange} confidence={null} />)

    fireEvent.change(screen.getByLabelText('Read as'), {
      target: { value: 'mariadb' },
    })

    expect(onChange).toHaveBeenCalledWith('mariadb')
  })

  it('reports null when the reader goes back to auto-detect', () => {
    const onChange = vi.fn()
    render(<SourceFormatSelect value="mysql" onChange={onChange} confidence={null} />)

    fireEvent.change(screen.getByLabelText('Read as'), {
      target: { value: 'auto' },
    })

    // null means "detect again", not "no format" — the hook re-reads the file.
    expect(onChange).toHaveBeenCalledWith(null)
  })
})

describe('SourceFormatSelect disclosure', () => {
  it('collapses to one line when detection recognised the engine', () => {
    render(
      <SourceFormatSelect value={null} onChange={vi.fn()} confidence="detected" />,
    )

    expect(screen.queryByLabelText('Read as')).toBeNull()
    expect(screen.getByRole('button', { name: /read as something else/i })).toBeInTheDocument()
  })

  it('opens the full list when the reader asks for it', () => {
    render(
      <SourceFormatSelect value={null} onChange={vi.fn()} confidence="detected" />,
    )

    fireEvent.click(screen.getByRole('button', { name: /read as something else/i }))
    expect(screen.getByLabelText('Read as')).toBeInTheDocument()
  })

  it('stays open when the engine was only assumed, not recognised', () => {
    // Nothing in the file named an engine, so the choice is the point here.
    render(
      <SourceFormatSelect value={null} onChange={vi.fn()} confidence="assumed" />,
    )

    expect(screen.getByLabelText('Read as')).toBeInTheDocument()
  })

  it('stays open once an engine has been pinned, so it can be undone', () => {
    render(
      <SourceFormatSelect value="mysql" onChange={vi.fn()} confidence="detected" />,
    )

    expect(screen.getByLabelText('Read as')).toBeInTheDocument()
  })
})
