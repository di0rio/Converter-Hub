import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CASE_STYLES } from '@sql-extractor/core'
import { CASE_LABELS, TextTool } from '@/components/text-tool'
import { findTool } from '@/lib/tools'

const input = () =>
  screen.getByLabelText(/^(?!Output)/, { selector: 'textarea' })
const output = () =>
  (
    screen.getByLabelText('Output', {
      selector: 'textarea',
    }) as HTMLTextAreaElement
  ).value

function type(value: string) {
  fireEvent.change(input(), { target: { value } })
}

let createObjectURL: ReturnType<typeof vi.fn>

beforeEach(() => {
  createObjectURL = vi.fn(() => 'blob:text')
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

describe('TextTool', () => {
  it('encodes as you type, and decodes in the other mode', () => {
    render(<TextTool id="encoding" />)

    type('héllo')
    expect(output()).toBe('aMOpbGxv')

    fireEvent.click(screen.getByRole('radio', { name: 'Base64 decode' }))
    type('aGk=')
    expect(output()).toBe('hi')
  })

  it('offers exactly the cases its hub card lists', () => {
    render(<TextTool id="case" />)

    const labels = CASE_STYLES.map((style) => CASE_LABELS[style])
    expect(labels).toEqual(findTool('case').output)
    for (const label of labels) {
      expect(screen.getByRole('radio', { name: label })).toBeTruthy()
    }

    fireEvent.click(screen.getByRole('radio', { name: 'snake_case' }))
    type('userName\nXMLHttp request')
    expect(output()).toBe('user_name\nxml_http_request')
  })

  it('shows a timestamp in every form and says what it assumed', () => {
    render(<TextTool id="timestamp" />)

    expect(screen.queryByRole('radiogroup')).toBeNull()
    type('2024-01-01T00:00')
    expect(output()).toContain('Unix seconds: 1704067200')
    expect(output()).toContain('ISO 8601 UTC: 2024-01-01T00:00:00.000Z')
    expect(output()).toContain('read as UTC')
  })

  it('shows a color in HEX, rgb and hsl', () => {
    render(<TextTool id="color" />)

    type('#fff')
    expect(output()).toBe(
      'HEX: #ffffff\nRGB: rgb(255, 255, 255)\nHSL: hsl(0, 0%, 100%)',
    )
  })

  it('refuses bad input with its own message and no output', () => {
    render(<TextTool id="color" />)

    type('rgb(300, 0, 0)')
    expect(screen.getByRole('alert').textContent).toMatch(/out of range/)
    expect(output()).toBe('')
  })

  it('downloads the generated types as a .ts file', async () => {
    render(<TextTool id="json-to-typescript" />)

    type('{"name": "Ada", "age": 36}')
    fireEvent.click(screen.getByRole('button', { name: /Download types\.ts/ }))

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob
    expect(await blob.text()).toContain('export interface Root')
  })

  it('copies the output to the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    render(<TextTool id="encoding" />)

    type('hi')
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }))

    expect(writeText).toHaveBeenCalledWith('aGk=')
    expect(await screen.findByRole('button', { name: /Copied/ })).toBeTruthy()
  })
})
