import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DataConverter } from '@/components/data-converter'

/**
 * The data tool end to end: pick a synthetic fixture, pick an output, convert,
 * download one file. Only the object URL the download goes through is stubbed.
 */

const fixture = (name: string) =>
  new File(
    [readFileSync(join(__dirname, '..', '..', '..', 'examples', 'data', name))],
    name,
  )

function select(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('no file input')
  fireEvent.change(input, { target: { files: [file] } })
}

let createObjectURL: ReturnType<typeof vi.fn>

beforeEach(() => {
  createObjectURL = vi.fn(() => 'blob:data')
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectURL,
    configurable: true,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DataConverter', () => {
  it('converts a JSON file to one CSV file', async () => {
    const { container } = render(<DataConverter />)

    select(container, fixture('people.json'))
    await screen.findByText(/Read as JSON/i)

    fireEvent.click(screen.getByRole('radio', { name: /^CSV/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Convert$/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Download CSV/ }))

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob
    expect(blob.type).toBe('text/csv')
    expect(await blob.text()).toContain('Grace Hopper')
  })

  it('says a nested document is not a table, and nothing from inside it', async () => {
    const { container } = render(<DataConverter />)

    select(container, fixture('nested.json'))
    await screen.findByText(/Read as JSON/i)

    fireEvent.click(screen.getByRole('radio', { name: /^CSV/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Convert$/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/not a table/i)
    expect(alert).not.toHaveTextContent(/theme|dark/)
  })

  it('refuses a file type it does not read', async () => {
    const { container } = render(<DataConverter />)

    select(container, new File(['%PDF-1.7'], 'report.pdf'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/not supported/i)
  })
})
