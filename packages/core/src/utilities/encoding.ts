import { DataFormatError } from '../records/index.js'

/**
 * Text encodings: Base64, hex, URL encoding and HTML entities.
 *
 * Base64 and hex describe bytes, so text goes through UTF-8 on the way in and
 * must be valid UTF-8 on the way out - `btoa` on its own only handles Latin-1
 * and would corrupt anything else. Nothing here depends on `Buffer` or `btoa`,
 * which the browser, Bun and Node do not all have.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(triple >> 18) & 63] as string
    out += B64[(triple >> 12) & 63] as string
    out += b === undefined ? '=' : (B64[(triple >> 6) & 63] as string)
    out += c === undefined ? '=' : (B64[triple & 63] as string)
  }
  return out
}

function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '')
  const body = clean.replace(/=+$/, '')
  if (
    !/^[A-Za-z0-9+/]*$/.test(body) ||
    body.length % 4 === 1 ||
    clean.length - body.length > 2
  ) {
    throw new DataFormatError('This is not valid Base64.')
  }

  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of body) {
    buffer = (buffer << 6) | B64.indexOf(char)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
      buffer &= (1 << bits) - 1
    }
  }
  return Uint8Array.from(bytes)
}

function utf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new DataFormatError('These bytes are not UTF-8 text.')
  }
}

export function encodeBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
}

export function decodeBase64(text: string): string {
  return utf8(base64ToBytes(text))
}

/** The UTF-8 bytes of text as lowercase hex, two digits a byte. */
export function encodeHex(text: string): string {
  return Array.from(new TextEncoder().encode(text), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/** Hex back to text. Whitespace between bytes is allowed; case is not. */
export function decodeHex(text: string): string {
  const clean = text.replace(/\s+/g, '')
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(clean)) {
    throw new DataFormatError('This is not valid hex.')
  }
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return utf8(bytes)
}

/** Every character outside the unreserved set, as `encodeURIComponent` does. */
export function encodeUrl(text: string): string {
  return encodeURIComponent(text)
}

export function decodeUrl(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    throw new DataFormatError('This text holds a broken percent-encoding.')
  }
}

export function encodeHtmlEntities(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The named entities decoded: the five HTML gives meaning to, and the
 * non-breaking space. Every numeric entity is decoded; an unknown named one
 * is left as it was rather than guessed at.
 */
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,
    (entity, body: string) => {
      if (!body.startsWith('#')) return NAMED[body] ?? entity
      const code = /^#x/i.test(body)
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      const valid = code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
      return valid ? String.fromCodePoint(code) : entity
    },
  )
}
