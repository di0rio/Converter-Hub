import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TextTool } from '@/components/text-tool'

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

// Encoding, case, timestamp and color are parked off the hub, so only JSON to
// TypeScript renders here. Their conversions stay covered by the core tests.
describe('TextTool', () => {
  it('writes types as you type, with no mode to pick', () => {
    render(<TextTool id="json-to-typescript" />)

    expect(screen.queryByRole('radiogroup')).toBeNull()
    type('{"name": "Ada"}')
    expect(output()).toContain('export interface Root')
    expect(output()).toContain('name: string')
  })

  it('refuses bad input with its own message and no output', () => {
    render(<TextTool id="json-to-typescript" />)

    type('{"name": ')
    expect(screen.getByRole('alert').textContent).toBe(
      'This is not valid JSON.',
    )
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
    render(<TextTool id="json-to-typescript" />)

    type('{"a": 1}')
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }))

    expect(writeText).toHaveBeenCalledWith(output())
    expect(await screen.findByRole('button', { name: /Copied/ })).toBeTruthy()
  })
})
