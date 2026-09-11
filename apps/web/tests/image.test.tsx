import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DataFormatError } from '@sql-extractor/core'
import { convertImage, isSvg } from '@/lib/image'
import { ImageConverter } from '@/components/image-converter'

const SVG = readFileSync(
  join(__dirname, '..', '..', '..', 'examples', 'image', 'sample.svg'),
  'utf8',
)

// jsdom neither decodes images nor draws them: this Image "loads" at a set
// size, and the canvas records what it was asked to do.
let size = { width: 120, height: 80 }
let decodes = true
let writes: string | null = null
let createObjectURL: ReturnType<typeof vi.fn>
let fillRect: ReturnType<typeof vi.fn>
let drawImage: ReturnType<typeof vi.fn>

class FakeImage {
  naturalWidth = 0
  naturalHeight = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_url: string) {
    queueMicrotask(() => {
      if (!decodes) return this.onerror?.()
      this.naturalWidth = size.width
      this.naturalHeight = size.height
      this.onload?.()
    })
  }
}

beforeEach(() => {
  size = { width: 120, height: 80 }
  decodes = true
  writes = null
  createObjectURL = vi.fn(() => 'blob:image')
  fillRect = vi.fn()
  drawImage = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectURL,
    configurable: true,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
  })
  vi.stubGlobal('Image', FakeImage)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => ({ fillRect, drawImage, fillStyle: '' })) as never,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    done: BlobCallback,
    type?: string,
  ) {
    done(new Blob(['pixels'], { type: writes ?? type ?? 'image/png' }))
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('isSvg', () => {
  it('knows an SVG by its content', () => {
    expect(isSvg(SVG)).toBe(true)
  })

  it.each([
    ['HTML', '<html><body></body></html>'],
    ['broken XML', '<svg xmlns="http://www.w3.org/2000/svg"><rect></svg'],
    ['an svg outside the SVG namespace', '<svg><rect/></svg>'],
    ['text', 'not an image'],
  ])('refuses %s', (_name, text) => {
    expect(isSvg(text)).toBe(false)
  })
})

describe('convertImage', () => {
  it('draws an SVG as an image, never as a document', async () => {
    const bytes = await convertImage(new Blob([SVG]), 'svg', 'png')

    expect(bytes.byteLength).toBeGreaterThan(0)
    // Loaded through <img> from a Blob URL typed as SVG: scripts do not run
    // and external resources are not fetched in that mode.
    const source = createObjectURL.mock.calls[0]?.[0] as Blob
    expect(source.type).toBe('image/svg+xml')
    expect(drawImage).toHaveBeenCalled()
    expect(fillRect).not.toHaveBeenCalled()
  })

  // The browser would draw it at a letterboxed 300×150 otherwise.
  it('gives an SVG with only a viewBox the viewBox size', async () => {
    const icon =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>'
    await convertImage(new Blob([icon]), 'svg', 'png')

    const source = await (createObjectURL.mock.calls[0]?.[0] as Blob).text()
    expect(source).toContain('width="64"')
    expect(source).toContain('height="64"')
  })

  it('leaves an SVG that sets its own size alone', async () => {
    await convertImage(new Blob([SVG]), 'svg', 'png')

    const source = await (createObjectURL.mock.calls[0]?.[0] as Blob).text()
    expect(source).toContain('width="120"')
    expect(source).toContain('height="80"')
  })

  it('paints JPEG onto white, since JPEG has no transparency', async () => {
    await convertImage(new Blob(['png']), 'png', 'jpeg')
    expect(fillRect).toHaveBeenCalledWith(0, 0, 120, 80)
  })

  it('refuses a .svg file that is not SVG', async () => {
    await expect(
      convertImage(new Blob(['<html></html>']), 'svg', 'png'),
    ).rejects.toThrow(DataFormatError)
  })

  it('refuses an image the browser cannot decode', async () => {
    decodes = false
    await expect(
      convertImage(new Blob(['junk']), 'avif', 'png'),
    ).rejects.toThrow(DataFormatError)
  })

  it.each([
    ['a side', { width: 20000, height: 10 }],
    // Each side is allowed; together they would be a gigabyte of canvas.
    ['the pixel count', { width: 16000, height: 16000 }],
  ])('refuses an image too large to draw by %s', async (_by, big) => {
    size = big
    await expect(
      convertImage(new Blob(['png']), 'png', 'webp'),
    ).rejects.toThrow(/too large/)
  })

  // A browser that cannot encode a type hands back PNG instead of failing.
  it('says so when the browser cannot write the format', async () => {
    writes = 'image/png'
    await expect(
      convertImage(new Blob(['png']), 'png', 'webp'),
    ).rejects.toThrow(/cannot write WebP/)
  })
})

describe('ImageConverter', () => {
  it('turns an SVG file into one PNG file', async () => {
    const { container } = render(<ImageConverter />)

    const input = container.querySelector('input[type="file"]')
    if (!input) throw new Error('no file input')
    fireEvent.change(input, {
      target: { files: [new File([SVG], 'sample.svg')] },
    })
    fireEvent.click(await screen.findByRole('button', { name: /^Convert$/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Download PNG/ }))

    const blob = createObjectURL.mock.lastCall?.[0] as Blob
    expect(blob.type).toBe('image/png')
    expect(container.querySelector('img, svg image, script')).toBeNull()
  })
})
