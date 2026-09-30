/**
 * Turning a column's bytes into a value.
 *
 * SQL Server keeps a column's whole type in one integer, `ti`: the type code
 * in the low byte and, depending on the type, either a byte length or a
 * precision and a scale above it. That is all the catalog stores about the
 * physical layout, and it is all this file needs — the reader never sees a
 * type name until it writes one out.
 */

import type { SqliteValue } from '../sqlite/index.js'

/** `xtype`, the type codes SQL Server uses in its own catalog. */
export const TYPE = {
  image: 34,
  text: 35,
  uniqueidentifier: 36,
  date: 40,
  time: 41,
  datetime2: 42,
  datetimeoffset: 43,
  tinyint: 48,
  smallint: 52,
  int: 56,
  smalldatetime: 58,
  real: 59,
  money: 60,
  datetime: 61,
  float: 62,
  variant: 98,
  ntext: 99,
  bit: 104,
  decimal: 106,
  numeric: 108,
  smallmoney: 122,
  bigint: 127,
  varbinary: 165,
  varchar: 167,
  binary: 173,
  char: 175,
  timestamp: 189,
  nvarchar: 231,
  nchar: 239,
  xml: 241,
} as const

export interface TypeInfo {
  xtype: number
  /** Declared byte length, for the types that carry one. */
  length: number
  precision: number
  scale: number
}

export function typeInfo(ti: number): TypeInfo {
  return {
    xtype: ti & 0xff,
    length: (ti >>> 8) & 0xffff,
    precision: (ti >>> 8) & 0xff,
    scale: (ti >>> 16) & 0xff,
  }
}

/** Columns whose value lives on its own pages, not in the row. */
export function isLargeObject(xtype: number): boolean {
  return (
    xtype === TYPE.text ||
    xtype === TYPE.ntext ||
    xtype === TYPE.image ||
    xtype === TYPE.xml ||
    xtype === TYPE.variant
  )
}

/** How many bytes a decimal of this precision occupies: a sign and an integer. */
function decimalBytes(precision: number): number {
  if (precision <= 9) return 5
  if (precision <= 19) return 9
  if (precision <= 28) return 13
  return 17
}

/** Seconds are kept to the declared number of decimal places, packed tight. */
function timeBytes(scale: number): number {
  if (scale <= 2) return 3
  if (scale <= 4) return 4
  return 5
}

/**
 * How wide the column is where it sits in the fixed part of a record.
 *
 * Variable-length columns are not stored there and never reach this.
 */
export function fixedWidth(info: TypeInfo): number {
  switch (info.xtype) {
    case TYPE.bit:
    case TYPE.tinyint:
      return 1
    case TYPE.smallint:
      return 2
    case TYPE.int:
    case TYPE.real:
    case TYPE.smalldatetime:
    case TYPE.smallmoney:
      return 4
    case TYPE.bigint:
    case TYPE.float:
    case TYPE.money:
    case TYPE.datetime:
    case TYPE.timestamp:
      return 8
    case TYPE.date:
      return 3
    case TYPE.uniqueidentifier:
      return 16
    case TYPE.time:
      return timeBytes(info.scale)
    case TYPE.datetime2:
      return timeBytes(info.scale) + 3
    case TYPE.datetimeoffset:
      return timeBytes(info.scale) + 5
    case TYPE.decimal:
    case TYPE.numeric:
      return decimalBytes(info.precision)
    default:
      return info.length
  }
}

/**
 * The fewest bytes a stored value of this type can occupy.
 *
 * Text and binary columns may be empty. Everything else has one size, and a
 * variable-length slot shorter than it belongs to a column the row was written
 * without — added by a later `ALTER TABLE`, and so not there at all.
 */
export function minimumBytes(info: TypeInfo): number {
  switch (info.xtype) {
    case TYPE.char:
    case TYPE.varchar:
    case TYPE.nchar:
    case TYPE.nvarchar:
    case TYPE.binary:
    case TYPE.varbinary:
      return 0
    default:
      return fixedWidth(info)
  }
}

const DAYS_TO_1900 = 25567
const DAYS_TO_0001 = -719162

/** The civil date a day number falls on, counted from 1970-01-01. */
function civil(days: number): string {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365,
  )
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp + (mp < 10 ? 3 : -9)
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0)
  return (
    String(year).padStart(4, '0') +
    '-' +
    String(month).padStart(2, '0') +
    '-' +
    String(day).padStart(2, '0')
  )
}

function clock(seconds: number, fraction: string): string {
  const s = Math.floor(seconds)
  return (
    String(Math.floor(s / 3600)).padStart(2, '0') +
    ':' +
    String(Math.floor(s / 60) % 60).padStart(2, '0') +
    ':' +
    String(s % 60).padStart(2, '0') +
    fraction
  )
}

/** A little-endian unsigned integer of any width this format uses. */
function unsigned(bytes: Uint8Array): bigint {
  let value = 0n
  for (let i = bytes.length - 1; i >= 0; i--)
    value = (value << 8n) | BigInt(bytes[i] as number)
  return value
}

function scaled(value: bigint, scale: number, negative: boolean): string {
  const digits = value.toString().padStart(scale + 1, '0')
  const whole = digits.slice(0, digits.length - scale)
  const fraction = scale > 0 ? '.' + digits.slice(digits.length - scale) : ''
  return (negative && value !== 0n ? '-' : '') + whole + fraction
}

function guid(v: DataView, at: number): string {
  const hex = (from: number, to: number) => {
    let out = ''
    for (let i = from; i < to; i++)
      out += v
        .getUint8(at + i)
        .toString(16)
        .padStart(2, '0')
    return out
  }
  const reversed = (from: number, to: number) => {
    let out = ''
    for (let i = to - 1; i >= from; i--)
      out += v
        .getUint8(at + i)
        .toString(16)
        .padStart(2, '0')
    return out
  }
  return [
    reversed(0, 4),
    reversed(4, 6),
    reversed(6, 8),
    hex(8, 10),
    hex(10, 16),
  ].join('-')
}

const decoders = new Map<string, TextDecoder>()

function decodeText(bytes: Uint8Array, label: string): string {
  let decoder = decoders.get(label)
  if (!decoder) {
    decoder = new TextDecoder(label)
    decoders.set(label, decoder)
  }
  return decoder.decode(bytes)
}

/**
 * The value a column's bytes stand for.
 *
 * Money and the decimal family come back as strings: they are exact in the
 * file and a double would not keep them so. `bitPosition` only matters for
 * `bit`, several of which share one byte.
 */
export function decodeValue(
  bytes: Uint8Array,
  info: TypeInfo,
  bitPosition: number,
  collationCodePage: string,
): SqliteValue {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  switch (info.xtype) {
    case TYPE.bit:
      return ((bytes[0] as number) >> bitPosition) & 1
    case TYPE.tinyint:
      return v.getUint8(0)
    case TYPE.smallint:
      return v.getInt16(0, true)
    case TYPE.int:
      return v.getInt32(0, true)
    case TYPE.bigint: {
      const value = v.getBigInt64(0, true)
      return within(value) ? Number(value) : value
    }
    case TYPE.real:
      return v.getFloat32(0, true)
    case TYPE.float:
      return v.getFloat64(0, true)

    case TYPE.money: {
      const value = v.getBigInt64(0, true)
      return scaled(value < 0n ? -value : value, 4, value < 0n)
    }
    case TYPE.smallmoney: {
      const value = v.getInt32(0, true)
      return scaled(BigInt(Math.abs(value)), 4, value < 0)
    }
    case TYPE.decimal:
    case TYPE.numeric:
      return scaled(unsigned(bytes.subarray(1)), info.scale, bytes[0] === 0)

    case TYPE.datetime: {
      const ticks = v.getUint32(0, true)
      const days = v.getInt32(4, true)
      const ms = Math.round(ticks / 0.3)
      return (
        civil(days - DAYS_TO_1900) +
        ' ' +
        clock(ms / 1000, '.' + String(ms % 1000).padStart(3, '0'))
      )
    }
    case TYPE.smalldatetime:
      return (
        civil(v.getUint16(0, true) - DAYS_TO_1900) +
        ' ' +
        clock(v.getUint16(2, true) * 60, '')
      )
    case TYPE.date:
      return civil(dayNumber(bytes, 0) + DAYS_TO_0001)
    case TYPE.time:
      return timeOfDay(bytes, 0, info.scale)
    case TYPE.datetime2:
      return moment(bytes, info.scale, 0)
    case TYPE.datetimeoffset: {
      // Stored as UTC, with the offset it was written in kept alongside.
      const minutes = v.getInt16(timeBytes(info.scale) + 3, true)
      return moment(bytes, info.scale, minutes) + offset(minutes)
    }

    case TYPE.uniqueidentifier:
      return guid(v, 0)
    case TYPE.char:
    case TYPE.varchar:
      return decodeText(bytes, collationCodePage).replace(/\0+$/, '')
    case TYPE.nchar:
    case TYPE.nvarchar:
      return decodeText(bytes, 'utf-16le').replace(/\0+$/, '')
    case TYPE.binary:
    case TYPE.varbinary:
    case TYPE.timestamp:
      return bytes.slice()

    default:
      // CLR types — hierarchyid, geometry, geography — are their own
      // serialisation, which only the type can read. The bytes are the value.
      return bytes.slice()
  }
}

function within(value: bigint): boolean {
  return (
    value <= BigInt(Number.MAX_SAFE_INTEGER) &&
    value >= BigInt(Number.MIN_SAFE_INTEGER)
  )
}

function dayNumber(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] as number) |
    ((bytes[at + 1] as number) << 8) |
    ((bytes[at + 2] as number) << 16)
  )
}

function timeOfDay(bytes: Uint8Array, at: number, scale: number): string {
  const units = unsigned(bytes.subarray(at, at + timeBytes(scale)))
  return clockOf(units, scale)
}

/** A time of day, from units of 10^-scale seconds since midnight. */
function clockOf(units: bigint, scale: number): string {
  const perSecond = 10n ** BigInt(scale)
  const rest = Number(units % perSecond)
  const fraction = scale > 0 ? '.' + String(rest).padStart(scale, '0') : ''
  return clock(Number(units / perSecond), fraction)
}

/**
 * A `datetime2`, or the local time of a `datetimeoffset`: the time units come
 * first, then the day, and `minutes` moves the pair across midnight if the
 * offset takes it there.
 */
function moment(bytes: Uint8Array, scale: number, minutes: number): string {
  const split = timeBytes(scale)
  const perSecond = 10n ** BigInt(scale)
  const perDay = 86400n * perSecond
  const total =
    BigInt(dayNumber(bytes, split)) * perDay +
    unsigned(bytes.subarray(0, split)) +
    BigInt(minutes) * 60n * perSecond

  const day = total / perDay
  return (
    civil(Number(day) + DAYS_TO_0001) +
    ' ' +
    clockOf(total - day * perDay, scale)
  )
}

function offset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const total = Math.abs(minutes)
  return (
    sign +
    String(Math.floor(total / 60)).padStart(2, '0') +
    ':' +
    String(total % 60).padStart(2, '0')
  )
}

/** How the column would be written back out, for the CREATE TABLE line. */
export function declaredType(info: TypeInfo): string {
  const { xtype, length, precision, scale } = info
  const chars = length === 0xffff ? 'max' : String(length)

  switch (xtype) {
    case TYPE.bit:
      return 'BIT'
    case TYPE.tinyint:
      return 'TINYINT'
    case TYPE.smallint:
      return 'SMALLINT'
    case TYPE.int:
      return 'INT'
    case TYPE.bigint:
      return 'BIGINT'
    case TYPE.real:
      return 'REAL'
    case TYPE.float:
      return 'FLOAT'
    case TYPE.money:
      return 'MONEY'
    case TYPE.smallmoney:
      return 'SMALLMONEY'
    case TYPE.decimal:
      return `DECIMAL(${precision},${scale})`
    case TYPE.numeric:
      return `NUMERIC(${precision},${scale})`
    case TYPE.date:
      return 'DATE'
    case TYPE.time:
      return `TIME(${scale})`
    case TYPE.datetime:
      return 'DATETIME'
    case TYPE.datetime2:
      return `DATETIME2(${scale})`
    case TYPE.datetimeoffset:
      return `DATETIMEOFFSET(${scale})`
    case TYPE.smalldatetime:
      return 'SMALLDATETIME'
    case TYPE.uniqueidentifier:
      return 'UNIQUEIDENTIFIER'
    case TYPE.timestamp:
      return 'ROWVERSION'
    case TYPE.char:
      return `CHAR(${chars})`
    case TYPE.varchar:
      return `VARCHAR(${chars})`
    case TYPE.nchar:
      return `NCHAR(${length === 0xffff ? 'max' : length / 2})`
    case TYPE.nvarchar:
      return `NVARCHAR(${length === 0xffff ? 'max' : length / 2})`
    case TYPE.binary:
      return `BINARY(${chars})`
    case TYPE.varbinary:
      return `VARBINARY(${chars})`
    case TYPE.text:
      return 'TEXT'
    case TYPE.ntext:
      return 'NTEXT'
    case TYPE.image:
      return 'IMAGE'
    case TYPE.xml:
      return 'XML'
    case TYPE.variant:
      return 'SQL_VARIANT'
    default:
      return 'VARBINARY(max)'
  }
}
