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
 * An SVG is checked by content — parsed with `DOMParser`, which runs nothing,
 * and required to have an `<svg>` root in the SVG namespace — then loaded
 * through `<img>` from a Blob URL. In that mode the browser runs no script
 * and fetches no external resource, and the SVG is never put into the page.
 */

export type ImageInput = (typeof IMAGE_INPUTS)[number]
export type ImageOutput = (typeof IMAGE_OUTPUTS)[number]

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/** Past this, some browsers refuse the canvas or hand back a blank one. */
const MAX_SIDE = 16384

/** JPEG and WebP quality: the browsers' own default for JPEG. */
const QUALITY = 0.92

export function isSvg(text: string): boolean {
  const document = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = document.documentElement
  return (
    document.getElementsByTagName('parsererror').length === 0 &&
    root?.localName === 'svg' &&
    root.namespaceURI === SVG_NAMESPACE
  )
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
    const text = await file.text()
    if (!isSvg(text))
      throw new DataFormatError('This file is not an SVG image.')
    // The SVG type is what makes the browser decode it as an image at all.
    source = new Blob([text], { type: FILE_FORMATS.svg.type })
  }

  const image = await load(source)
  // ponytail: an SVG with no absolute width and height gets the browser's
  // default 300×150; read its viewBox if that ever matters.
  const width = image.naturalWidth || 300
  const height = image.naturalHeight || 150
  if (width > MAX_SIDE || height > MAX_SIDE) {
    throw new DataFormatError(
      `This image is too large to convert. The longest side this tool draws is ${MAX_SIDE} pixels.`,
    )
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
