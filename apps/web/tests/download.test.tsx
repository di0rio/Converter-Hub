import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Wand2 } from 'lucide-react'
import { downloadFile } from '@/lib/download'
import { DownloadStep } from '@/components/download-step'

let blobs: Blob[]

beforeEach(() => {
  blobs = []
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn((blob: Blob) => {
      blobs.push(blob)
      return 'blob:file'
    }),
    configurable: true,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('downloadFile', () => {
  it('hands the browser one file, with its own name and type', async () => {
    let saved = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved = this.download
    })

    downloadFile('a,b\n', 'people.csv', 'text/csv')

    expect(saved).toBe('people.csv')
    expect(blobs[0]?.type).toBe('text/csv')
    expect(await blobs[0]?.text()).toBe('a,b\n')
  })
})

describe('DownloadStep', () => {
  const props = {
    id: 'step',
    label: 'Convert and download',
    pending: 'Ready.',
    actionLabel: 'Convert',
    actionIcon: Wand2,
    busyLabel: 'Converting...',
    busy: false,
    facts: [],
    onRun: () => {},
    onReset: () => {},
    onError: () => {},
  }

  it('names a single file by its format', () => {
    render(
      <DownloadStep
        {...props}
        result={{
          filename: 'people.csv',
          bytes: new TextEncoder().encode('a\n'),
          type: 'text/csv',
        }}
      />,
    )

    expect(
      screen.getByRole('button', { name: /Download CSV/i }),
    ).toBeInTheDocument()
  })

  it('still offers an archive as a ZIP', () => {
    render(
      <DownloadStep
        {...props}
        result={{ filename: 'shop.zip', bytes: new Uint8Array([1]) }}
      />,
    )

    expect(
      screen.getByRole('button', { name: /Download ZIP/i }),
    ).toBeInTheDocument()
  })
})
