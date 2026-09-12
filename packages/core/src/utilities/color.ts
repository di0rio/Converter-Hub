import { DataFormatError } from '../records/index.js'

/**
 * One sRGB color, written as HEX, rgb() and hsl().
 *
 * Reads `#rgb`, `#rrggbb`, `rgb(r, g, b)` with 0–255 channels, and
 * `hsl(h, s%, l%)` with a 0–360 hue - each with commas or spaces. A value out
 * of range is refused rather than clamped: clamping would hand back a
 * different color than the one asked about. HSL is rounded to whole numbers,
 * so a HEX color converted to HSL and back can move by one step per channel.
 */

export type Color = { hex: string; rgb: string; hsl: string }

type Rgb = [number, number, number]

const SEPARATOR = String.raw`(?:\s*,\s*|\s+)`
const NUMBER = String.raw`(-?\d+(?:\.\d+)?)`
const RGB = new RegExp(
  String.raw`^rgb\(\s*${NUMBER}${SEPARATOR}${NUMBER}${SEPARATOR}${NUMBER}\s*\)$`,
  'i',
)
const HSL = new RegExp(
  String.raw`^hsl\(\s*${NUMBER}(?:deg)?${SEPARATOR}${NUMBER}%${SEPARATOR}${NUMBER}%\s*\)$`,
  'i',
)

function refuse(): DataFormatError {
  return new DataFormatError(
    'This is not a hex, rgb() or hsl() color, or a value is out of range.',
  )
}

function inRange(value: number, max: number): number {
  if (value < 0 || value > max) throw refuse()
  return value
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const saturation = s / 100
  const lightness = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = saturation * Math.min(lightness, 1 - lightness)
  const channel = (n: number) =>
    Math.round(
      (lightness - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255,
    )
  return [channel(0), channel(8), channel(4)]
}

function rgbToHsl([r, g, b]: Rgb): string {
  const [red, green, blue] = [r / 255, g / 255, b / 255]
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  const delta = max - min
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))

  let hue = 0
  if (delta !== 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6)
    else if (max === green) hue = 60 * ((blue - red) / delta + 2)
    else hue = 60 * ((red - green) / delta + 4)
  }
  if (hue < 0) hue += 360

  return `hsl(${Math.round(hue) % 360}, ${Math.round(saturation * 100)}%, ${Math.round(lightness * 100)}%)`
}

function read(text: string): Rgb {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex) {
    const digits = hex[1] as string
    const full =
      digits.length === 3
        ? digits
            .split('')
            .map((digit) => digit + digit)
            .join('')
        : digits
    return [0, 2, 4].map((i) =>
      Number.parseInt(full.slice(i, i + 2), 16),
    ) as Rgb
  }

  const rgb = RGB.exec(text)
  if (rgb) {
    const channels = rgb.slice(1, 4).map(Number)
    if (!channels.every(Number.isInteger)) throw refuse()
    return channels.map((value) => inRange(value, 255)) as Rgb
  }

  const hsl = HSL.exec(text)
  if (hsl) {
    const [h, s, l] = hsl.slice(1, 4).map(Number) as Rgb
    return hslToRgb(inRange(h, 360), inRange(s, 100), inRange(l, 100))
  }

  throw refuse()
}

export function convertColor(input: string): Color {
  const rgb = read(input.trim())
  return {
    hex: `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`,
    rgb: `rgb(${rgb.join(', ')})`,
    hsl: rgbToHsl(rgb),
  }
}
