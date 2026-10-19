import type { SqliteValue } from '../sqlite/index.js'
import { OEM_HIGH_HALF } from './codepages.js'
import { damaged, type DbfField } from './header.js'
import type { MemoFile } from './memo.js'

/**
 * The language driver byte names the code page the character fields were
 * written in. A number points at an OEM table this package carries; a string is
 * a label the platform's own TextDecoder knows.
 */
const LANGUAGE_DRIVERS: Record<number, number | string> = {
  0x01: 437,
  0x02: 850,
  0x03: 'windows-1252',
  0x04: 'macintosh',
  0x08: 865,
  0x09: 437,
  0x0a: 850,
  0x0b: 437,
  0x0d: 437,
  0x0e: 850,
  0x0f: 437,
  0x10: 850,
  0x11: 437,
  0x12: 850,
  0x13: 'shift_jis',
  0x14: 850,
  0x15: 437,
  0x16: 850,
  0x17: 865,
  0x18: 437,
  0x19: 437,
  0x1a: 850,
  0x1b: 437,
  0x1c: 863,
  0x1d: 850,
  0x1f: 852,
  0x22: 852,
  0x23: 852,
  0x24: 860,
  0x25: 850,
  0x26: 'ibm866',
  0x37: 850,
  0x40: 852,
  0x4d: 'gbk',
  0x4e: 'euc-kr',
  0x4f: 'big5',
  0x50: 'windows-874',
  0x57: 'windows-1252',
  0x58: 'windows-1252',
  0x59: 'windows-1252',
  0x64: 852,
  0x65: 'ibm866',
  0x66: 865,
  0x67: 861,
  0x6a: 'windows-1253',
  0x6b: 857,
  0x6c: 863,
  0x78: 'big5',
  0x79: 'euc-kr',
  0x7a: 'gbk',
  0x7b: 'shift_jis',
  0x7c: 'windows-874',
  0x86: 'windows-1253',
  0x87: 852,
  0x88: 857,
  0xc8: 'windows-1250',
  0xc9: 'windows-1251',
  0xca: 'windows-1254',
  0xcb: 'windows-1253',
  0xcc: 'windows-1257',
}

/**
 * What to read character fields as when the table does not say.
 *
 * Plenty of writers leave the language driver byte at zero. Windows-1252 keeps
 * every ASCII byte as it is and is what Windows-era tools wrote, so it is the
 * safer guess than an OEM page; `encoding` overrides it.
 */
export const DEFAULT_ENCODING = 'windows-1252'

export class Text {
  private readonly oem: string | undefined
  private readonly decoder: TextDecoder | undefined

  constructor(encoding: number | string) {
    if (typeof encoding === 'number') {
      this.oem = OEM_HIGH_HALF[encoding]
      if (this.oem === undefined) {
        this.decoder = new TextDecoder(DEFAULT_ENCODING)
      }
      return
    }
    try {
      this.decoder = new TextDecoder(encoding)
    } catch {
      this.decoder = new TextDecoder(DEFAULT_ENCODING)
    }
  }

  decode(bytes: Uint8Array): string {
    const oem = this.oem
    if (oem === undefined) return (this.decoder as TextDecoder).decode(bytes)
    let text = ''
    for (const byte of bytes) {
      text += byte < 128 ? String.fromCharCode(byte) : oem[byte - 128]
    }
    return text
  }
}

/** The encoding to read a table's character fields in. */
export function encodingFor(
  languageDriver: number,
  override: number | string | undefined,
): number | string {
  if (override !== undefined) return override
  return LANGUAGE_DRIVERS[languageDriver] ?? DEFAULT_ENCODING
}

/** dBase pads character fields with spaces, and some writers with NULs. */
function trimPadding(text: string): string {
  return text.replace(/[\s\0]+$/u, '')
}

function asciiText(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return text
}

function readNumber(bytes: Uint8Array, decimals: number): SqliteValue {
  const text = asciiText(bytes).trim().replace(/\0/g, '')
  // A field too narrow for its value is filled with asterisks by dBase.
  if (text === '' || text.startsWith('*')) return null
  if (decimals === 0 && /^[+-]?\d+$/.test(text)) {
    const whole = Number(text)
    return Number.isSafeInteger(whole) ? whole : BigInt(text)
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

function readDate(bytes: Uint8Array): SqliteValue {
  const text = asciiText(bytes).trim()
  if (!/^\d{8}$/.test(text) || text === '00000000') return null
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
}

function readLogical(bytes: Uint8Array): SqliteValue {
  const char = String.fromCharCode(bytes[0] ?? 0x20).toUpperCase()
  if (char === 'T' || char === 'Y') return 1
  if (char === 'F' || char === 'N') return 0
  return null
}

/** Julian day 2440588 is 1970-01-01, where the epoch starts. */
const JULIAN_EPOCH = 2440588
const MS_PER_DAY = 86_400_000

function readTimestamp(view: DataView, at: number): SqliteValue {
  const day = view.getInt32(at, true)
  const time = view.getInt32(at + 4, true)
  if (day === 0 && time === 0) return null
  const epoch = (day - JULIAN_EPOCH) * MS_PER_DAY + time
  if (!Number.isFinite(epoch) || Math.abs(epoch) > 8.64e15) return null
  const iso = new Date(epoch).toISOString()
  const fraction = ((time % 1000) + 1000) % 1000
  const stamp = `${iso.slice(0, 10)} ${iso.slice(11, 19)}`
  return fraction === 0
    ? stamp
    : `${stamp}.${String(fraction).padStart(3, '0')}`
}

/** Currency is a 64-bit integer scaled by four decimal places. */
function readCurrency(view: DataView, at: number): SqliteValue {
  const scaled = view.getBigInt64(at, true)
  const whole = Number(scaled)
  if (Number.isSafeInteger(whole)) return whole / 10_000
  const negative = scaled < 0n
  const digits = (negative ? -scaled : scaled).toString().padStart(5, '0')
  const cut = digits.length - 4
  return `${negative ? '-' : ''}${digits.slice(0, cut)}.${digits.slice(cut)}`
}

/** The block number a memo field points at, written either way round. */
function memoBlock(bytes: Uint8Array, view: DataView, at: number): number {
  if (bytes.length === 4) return view.getUint32(at, true)
  const text = asciiText(bytes).trim()
  return /^\d+$/.test(text) ? Number(text) : 0
}

export interface ValueContext {
  text: Text
  memo: MemoFile | null
  /** Set once a memo field was found with no memo file beside the table. */
  missingMemo: boolean
}

export function readValue(
  record: Uint8Array,
  view: DataView,
  field: DbfField,
  context: ValueContext,
  varLength: number | null,
): SqliteValue {
  const at = field.offset
  if (at + field.length > record.length) {
    throw damaged('field outside its record')
  }
  const bytes = record.subarray(at, at + field.length)

  switch (field.type) {
    case 'C':
      return field.binary
        ? bytes.slice()
        : trimPadding(context.text.decode(bytes))
    case 'N':
    case 'F':
      return readNumber(bytes, field.decimals)
    case 'D':
      return readDate(bytes)
    case 'L':
      return readLogical(bytes)
    case 'I':
    case '+':
      return field.length >= 4 ? view.getInt32(at, true) : null
    case 'O':
      return field.length >= 8 ? view.getFloat64(at, true) : null
    case 'B':
      // dBase IV used B for a binary memo; Visual FoxPro for a double.
      if (field.length >= 8) return view.getFloat64(at, true)
      return readMemo(bytes, view, field, context)
    case 'Y':
      return field.length >= 8 ? readCurrency(view, at) : null
    case 'T':
    case '@':
      return field.length >= 8 ? readTimestamp(view, at) : null
    case 'M':
    case 'G':
    case 'P':
      return readMemo(bytes, view, field, context)
    case 'V':
    case 'Q': {
      const width = varLength === null ? field.length : varLength
      if (width < 0 || width > field.length) throw damaged('varchar length')
      const used = bytes.subarray(0, width)
      return field.type === 'Q' || field.binary
        ? used.slice()
        : context.text.decode(used)
    }
    default:
      return trimPadding(context.text.decode(bytes))
  }
}

function readMemo(
  bytes: Uint8Array,
  view: DataView,
  field: DbfField,
  context: ValueContext,
): SqliteValue {
  const block = memoBlock(bytes, view, field.offset)
  if (block === 0) return null
  if (!context.memo) {
    context.missingMemo = true
    return null
  }
  const memo = context.memo.read(block)
  if (!memo) return null
  return memo.text && field.type !== 'G' && field.type !== 'P' && !field.binary
    ? trimPadding(context.text.decode(memo.bytes))
    : memo.bytes
}

export function declaredType(field: DbfField): string {
  switch (field.type) {
    case 'C':
      return field.binary ? `BINARY(${field.length})` : `CHAR(${field.length})`
    case 'N':
      return field.decimals > 0
        ? `NUMERIC(${field.length},${field.decimals})`
        : `NUMERIC(${field.length})`
    case 'F':
      return 'FLOAT'
    case 'D':
      return 'DATE'
    case 'L':
      return 'LOGICAL'
    case 'I':
      return 'INTEGER'
    case '+':
      return 'INTEGER'
    case 'O':
      return 'DOUBLE'
    case 'B':
      return field.length >= 8 ? 'DOUBLE' : 'MEMO'
    case 'Y':
      return 'CURRENCY'
    case 'T':
    case '@':
      return 'TIMESTAMP'
    case 'M':
      return 'MEMO'
    case 'G':
      return 'GENERAL'
    case 'P':
      return 'PICTURE'
    case 'V':
      return `VARCHAR(${field.length})`
    case 'Q':
      return `VARBINARY(${field.length})`
    default:
      return `CHAR(${field.length})`
  }
}
