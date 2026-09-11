import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MarkdownConverter } from '@/components/markdown-converter'

const fixture = (name: string) =>
  new File(
    [
      readFileSync(
        join(__dirname, '..', '..', '..', 'examples', 'markdown', name),
      ),
    ],
    name,
  )

function select(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('no file input')
  fireEvent.change(input, { target: { files: [file] } })
}

let createObjectURL: ReturnType<typeof vi.fn>

beforeEach(() => {
  createObjectURL = vi.fn(() => 'blob:markdown')
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

describe('MarkdownConverter', () => {
  it('turns a Markdown file into one HTML file', async () => {
    const { container } = render(<MarkdownConverter />)

    select(container, fixture('sample.md'))
    fireEvent.click(await screen.findByRole('button', { name: /^Convert$/ }))
    fireEvent.click(
      await screen.findByRole('button', { name: /Download HTML/ }),
    )

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob
    expect(blob.type).toBe('text/html')
    const html = await blob.text()
    expect(html).toContain('<h1>Field notes</h1>')
    expect(html).not.toContain('<script>')
  })

  it('turns an HTML file into one Markdown file', async () => {
    const { container } = render(<MarkdownConverter />)

    fireEvent.click(screen.getByRole('radio', { name: /HTML to Markdown/ }))
    select(container, fixture('sample.html'))
    fireEvent.click(await screen.findByRole('button', { name: /^Convert$/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Download MD/ }))

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob
    expect(blob.type).toBe('text/markdown')
    expect(await blob.text()).toContain('# Field notes')
  })

  it('reads only the kind of file the chosen direction takes', () => {
    const { container } = render(<MarkdownConverter />)

    select(container, fixture('sample.html'))
    expect(screen.getByRole('alert').textContent).toMatch(/Choose a \.md/)
  })

  it('never renders the document it converts', async () => {
    const { container } = render(<MarkdownConverter />)

    fireEvent.click(screen.getByRole('radio', { name: /HTML to Markdown/ }))
    select(container, fixture('sample.html'))
    await screen.findByRole('button', { name: /^Convert$/ })

    expect(container.querySelector('script, iframe, table')).toBeNull()
  })
})
