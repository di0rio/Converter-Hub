import type { SqliteValue } from '../sqlite/index.js'
import { damaged, type Blob } from './binary.js'

/**
 * Field values in a Firebird record, from the descriptor of the record's
 * format. Dtype codes are Firebird's own (`dsc.h`).
 */

export const DTYPE = {
  text: 1,
  cstring: 2,
  varying: 3,
  short: 8,
  long: 9,
  quad: 10,
  real: 11,
  double: 12,
  dFloat: 13,
  date: 14,
  time: 15,
  timestamp: 16,
  blob: 17,
  array: 18,
  int64: 19,
} as const

export interface Descriptor {
  dtype: number
  scale: number
  length: number
  subType: number
  offset: number
}

/** Firebird's character set ids (`charsets.h`), by the names RDB$ uses. */
export const CHARSET_IDS: Record<string, number> = {
  NONE: 0,
  OCTETS: 1,
  BINARY: 1,
  ASCII: 2,
  UNICODE_FSS: 3,
  UTF8: 4,
  SJIS_0208: 5,
  EUCJ_0208: 6,
  DOS437: 10,
  DOS850: 11,
  ISO8859_1: 21,
  ISO8859_2: 22,
  ISO8859_3: 23,
  ISO8859_4: 34,
  ISO8859_5: 35,
  ISO8859_6: 36,
  ISO8859_7: 37,
  ISO8859_8: 38,
  ISO8859_9: 39,
  ISO8859_13: 40,
  KSC_5601: 44,
  DOS866: 48,
  WIN1250: 51,
  WIN1251: 52,
  WIN1252: 53,
  WIN1253: 54,
  WIN1254: 55,
  BIG_5: 56,
  GB_2312: 57,
  WIN1255: 58,
  WIN1256: 59,
  WIN1257: 60,
  KOI8R: 63,
  KOI8U: 64,
  WIN1258: 65,
  TIS620: 66,
  GBK: 67,
  GB18030: 69,
}

export const WIN1252 = 53

/** The `TextDecoder` label for each character set it can decode. */
const LABELS: Record<number, string> = {
  2: 'windows-1252',
  3: 'utf-8',
  4: 'utf-8',
  5: 'shift_jis',
  6: 'euc-jp',
  21: 'iso-8859-1',
  22: 'iso-8859-2',
  23: 'iso-8859-3',
  34: 'iso-8859-4',
  35: 'iso-8859-5',
  36: 'iso-8859-6',
  37: 'iso-8859-7',
  38: 'iso-8859-8',
  39: 'iso-8859-9',
  40: 'iso-8859-13',
  44: 'euc-kr',
  48: 'ibm866',
  51: 'windows-1250',
  52: 'windows-1251',
  53: 'windows-1252',
  54: 'windows-1253',
  55: 'windows-1254',
  56: 'big5',
  57: 'gbk',
  58: 'windows-1255',
  59: 'windows-1256',
  60: 'windows-1257',
  63: 'koi8-r',
  64: 'koi8-u',
  65: 'windows-1258',
  66: 'windows-874',
  67: 'gbk',
  69: 'gb18030',
}

/** Whether text in this character set can be read; OCTETS is kept as bytes. */
export function readableCharset(id: number): boolean {
  return id === 1 || LABELS[id] !== undefined
}

const decoders = new Map<string, TextDecoder>()

function decodeText(bytes: Uint8Array, charset: number): SqliteValue {
  if (charset === 1) return bytes.slice()
  const label = LABELS[charset]
  if (!label) throw damaged(`unsupported character set ${charset}`)
  let decoder = decoders.get(label)
  if (!decoder) {
    decoder = new TextDecoder(label)
    decoders.set(label, decoder)
  }
  return decoder.decode(bytes)
}

export interface DecodeContext {
  /** The character set a column in NONE is read as. */
  defaultCharset: number
  /** Whether blob headers carry their character set (ODS 11.1 and later). */
  blobCharsetInHeader: boolean
  blob(relation: number, number: number): Blob
}

/** Whether a field is NULL: its bit is set in the record's leading bitmap. */
export function isNull(record: Uint8Array, index: number): boolean {
  const byte = record[index >> 3]
  return byte === undefined || (byte & (1 << (index & 7))) !== 0
}

/** An exact decimal string for an integer with a negative scale. */
export function scaled(value: bigint, scale: number): SqliteValue {
  if (scale === 0) {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) &&
      value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value
  }
  if (scale > 0) return (value * 10n ** BigInt(scale)).toString()
  const digits = -scale
  const negative = value < 0n
  const text = (negative ? -value : value).toString().padStart(digits + 1, '0')
  return `${negative ? '-' : ''}${text.slice(0, -digits)}.${text.slice(-digits)}`
}

const DAY_MS = 86_400_000
const MJD_EPOCH = Date.UTC(1858, 10, 17)

/** A Firebird DATE: days since 17 November 1858. */
export function formatDate(days: number): string {
  return new Date(MJD_EPOCH + days * DAY_MS).toISOString().slice(0, 10)
}

/** A Firebird TIME: ten-thousandths of a second since midnight. */
export function formatTime(units: number): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  const seconds = Math.floor(units / 10_000)
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}.${pad(units % 10_000, 4)}`
}

/** One field's value. The caller has already checked it is not NULL. */
export function decodeValue(
  record: Uint8Array,
  desc: Descriptor,
  context: DecodeContext,
): SqliteValue {
  const { offset, length } = desc
  if (offset + length > record.length) throw damaged('field outside its record')
  const v = new DataView(record.buffer, record.byteOffset + offset, length)
  const charset = (id: number) => (id === 0 ? context.defaultCharset : id)

  switch (desc.dtype) {
    case DTYPE.text:
      return trimPad(
        decodeText(
          record.subarray(offset, offset + length),
          charset(desc.subType & 0xff),
        ),
      )
    case DTYPE.cstring: {
      const bytes = record.subarray(offset, offset + length)
      const end = bytes.indexOf(0)
      return decodeText(
        end < 0 ? bytes : bytes.subarray(0, end),
        charset(desc.subType & 0xff),
      )
    }
    case DTYPE.varying: {
      const size = v.getUint16(0, true)
      if (2 + size > length) throw damaged('varchar longer than its field')
      return decodeText(
        record.subarray(offset + 2, offset + 2 + size),
        charset(desc.subType & 0xff),
      )
    }
    case DTYPE.short:
      return scaled(BigInt(v.getInt16(0, true)), desc.scale)
    case DTYPE.long:
      return scaled(BigInt(v.getInt32(0, true)), desc.scale)
    case DTYPE.int64:
    case DTYPE.quad:
      return scaled(v.getBigInt64(0, true), desc.scale)
    case DTYPE.real:
      return v.getFloat32(0, true)
    case DTYPE.double:
    case DTYPE.dFloat:
      return v.getFloat64(0, true)
    case DTYPE.date:
      return formatDate(v.getInt32(0, true))
    case DTYPE.time:
      return formatTime(v.getUint32(0, true))
    case DTYPE.timestamp:
      return `${formatDate(v.getInt32(0, true))} ${formatTime(v.getUint32(4, true))}`
    case DTYPE.blob: {
      const relation = v.getUint16(0, true)
      const number = v.getUint32(4, true) + v.getUint8(3) * 2 ** 32
      if (relation === 0 && number === 0) return null
      const blob = context.blob(relation, number)
      if (desc.subType !== 1) return blob.data.slice()
      const id = context.blobCharsetInHeader ? blob.charset : desc.scale & 0xff
      return decodeText(blob.data, charset(id))
    }
    default:
      throw damaged(`unsupported field type ${desc.dtype}`)
  }
}

/** CHAR is padded with spaces to its length; the padding is not the value. */
function trimPad(value: SqliteValue): SqliteValue {
  return typeof value === 'string' ? value.replace(/ +$/, '') : value
}
