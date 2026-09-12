import { DataFormatError } from '@sql-extractor/core'
import {
  FILE_FORMATS,
  type IMAGE_INPUTS,
  type IMAGE_OUTPUTS,
} from '@/lib/formats'

/**
 * Image conversion with nothing but the browser: decode through an `Image`,
 * draw onto a canvas, encode with `canvas.toBlob`.
 *
 * An SVG is checked by content - parsed with `DOMParser`, which runs nothing,
 * and required to have an `<svg>` root in the SVG namespace - then loaded
 * through `<img>` from a Blob URL. In that mode the browser runs no script
 * and fetches no external resource, and the SVG is never put into the page.
 */

export type ImageInput = (typeof IMAGE_INPUTS)[number]
export type ImageOutput = (typeof IMAGE_OUTPUTS)[number]

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/** Past this, some browsers refuse the canvas or hand back a blank one. */
const MAX_SIDE = 16384

/**
 * A canvas costs four bytes a pixel, so a small file that decodes to a huge
 * image could take gigabytes. This caps the canvas near 256 MB.
 */
const MAX_PIXELS = 64 * 1024 * 1024

/** JPEG and WebP quality: the browsers' own default for JPEG. */
const QUALITY = 0.92

/** The `<svg>` root of a document, or null when the text is not SVG. */
function parseSvg(text: string): Element | null {
  const document = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = document.documentElement
  return document.getElementsByTagName('parsererror').length === 0 &&
    root?.localName === 'svg' &&
    root.namespaceURI === SVG_NAMESPACE
    ? root
    : null
}

export function isSvg(text: string): boolean {
  return parseSvg(text) !== null
}

const ABSOLUTE = /^\s*\d+(\.\d+)?(px)?\s*$/

/**
 * An SVG with neither an absolute width nor height is drawn by the browser at
 * a default 300×150, letterboxed. Given a viewBox, it gets that size instead.
 * With one of the two set, the browser already derives the other from it.
 */
function withSize(root: Element): string {
  const width = root.getAttribute('width') ?? ''
  const height = root.getAttribute('height') ?? ''
  const box = (root.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const [, , boxWidth = 0, boxHeight = 0] = box
  if (
    !ABSOLUTE.test(width) &&
    !ABSOLUTE.test(height) &&
    boxWidth > 0 &&
    boxHeight > 0
  ) {
    root.setAttribute('width', String(boxWidth))
    root.setAttribute('height', String(boxHeight))
  }
  return new XMLSerializer().serializeToString(root)
}

function load(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  const image = new Image()
  return new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image)
    image.onerror = () =>
      reject(
        new DataFormatError(
          'This image could not be read. It may be damaged, or in a format this browser cannot open.',
        ),
      )
    image.src = url
  }).finally(() => URL.revokeObjectURL(url))
}

export async function convertImage(
  file: Blob,
  input: ImageInput,
  output: ImageOutput,
): Promise<Uint8Array> {
  let source = file
  if (input === 'svg') {
    const root = parseSvg(await file.text())
    if (!root) throw new DataFormatError('This file is not an SVG image.')
    // The SVG type is what makes the browser decode it as an image at all.
    source = new Blob([withSize(root)], { type: FILE_FORMATS.svg.type })
  }

  const image = await load(source)
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    throw new DataFormatError(
      `This image is too large to convert. This tool draws up to ${MAX_SIDE} pixels a side and ${MAX_PIXELS / 1024 / 1024} million pixels in all.`,
    )
  }
  if (width === 0 || height === 0) {
    throw new DataFormatError('This image has no size to draw.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new DataFormatError('This browser cannot draw images.')
  if (output === 'jpeg') {
    // JPEG has no transparency; unpainted pixels would come out black.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
  }
  context.drawImage(image, 0, 0, width, height)

  const { type, label } = FILE_FORMATS[output]
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, QUALITY),
  )
  // A browser that cannot encode a type quietly writes PNG instead.
  if (!blob || blob.type !== type) {
    throw new DataFormatError(`This browser cannot write ${label}.`)
  }
  return new Uint8Array(await blob.arrayBuffer())
}
