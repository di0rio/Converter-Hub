import { damaged } from './binary.js'
import { TIME_ZONES } from './time-zones.js'

// Types Firebird 4 added: DECFLOAT and the WITH TIME ZONE date-times. Both are
// written back as text the way Firebird's own isql shows them.

/** The three digits one 10-bit densely packed decimal declet encodes. */
function declet(bits: number): string {
  const b = (i: number) => (bits >> i) & 1
  const top = (bits >> 7) & 7
  const mid = (bits >> 4) & 7
  const low = bits & 7
  let d: [number, number, number]
  if (!b(3)) d = [top, mid, low]
  else {
    switch ((bits >> 1) & 3) {
      case 0:
        d = [top, mid, 8 + b(0)]
        break
      case 1:
        d = [top, 8 + b(4), (((bits >> 5) & 3) << 1) | b(0)]
        break
      case 2:
        d = [8 + b(7), mid, (((bits >> 8) & 3) << 1) | b(0)]
        break
      default:
        switch ((bits >> 5) & 3) {
          case 0:
            d = [8 + b(7), 8 + b(4), (((bits >> 8) & 3) << 1) | b(0)]
            break
          case 1:
            d = [8 + b(7), (((bits >> 8) & 3) << 1) | b(4), 8 + b(0)]
            break
          case 2:
            d = [top, 8 + b(4), 8 + b(0)]
            break
          default:
            d = [8 + b(7), 8 + b(4), 8 + b(0)]
        }
    }
  }
  return d.join('')
}

/**
 * An IEEE 754 decimal64 or decimal128 in the densely packed encoding
 * Firebird's decNumber library stores, as decNumber's scientific string.
 */
export function decodeDecFloat(bytes: DataView, size: 8 | 16): string {
  const width = BigInt(size * 8)
  const value =
    size === 8
      ? bytes.getBigUint64(0, true)
      : (bytes.getBigUint64(8, true) << 64n) | bytes.getBigUint64(0, true)
  const sign = (value >> (width - 1n)) & 1n ? '-' : ''
  const combination = Number((value >> (width - 6n)) & 31n)
  if ((combination & 0b11110) === 0b11110) {
    if (!(combination & 1)) return `${sign}Infinity`
    return (value >> (width - 7n)) & 1n ? `${sign}sNaN` : `${sign}NaN`
  }

  const continuation = size === 8 ? 8 : 12
  const bias = size === 8 ? 398 : 6176
  const declets = size === 8 ? 5 : 11
  const large = combination >> 3 === 3
  const high = large ? (combination >> 1) & 3 : combination >> 3
  const lead = large ? 8 + (combination & 1) : combination & 7
  const low = Number(
    (value >> BigInt(declets * 10)) & ((1n << BigInt(continuation)) - 1n),
  )
  const exponent = ((high << continuation) | low) - bias

  let digits = String(lead)
  for (let i = declets - 1; i >= 0; i--) {
    digits += declet(Number((value >> BigInt(i * 10)) & 1023n))
  }
  digits = digits.replace(/^0+(?=\d)/, '')

  const adjusted = exponent + digits.length - 1
  if (exponent <= 0 && adjusted >= -6) {
    if (exponent === 0) return sign + digits
    const point = digits.length + exponent
    return point > 0
      ? `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
      : `${sign}0.${'0'.repeat(-point)}${digits}`
  }
  const mantissa =
    digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits
  return `${sign}${mantissa}E${adjusted >= 0 ? '+' : ''}${adjusted}`
}

const GMT = 65535
/** Offsets are stored as minutes plus this, so -23:59 is 0. */
const ONE_DAY = 24 * 60 - 1

/** The date Firebird converts a TIME WITH TIME ZONE on: 2020-01-01. */
export const TIME_TZ_BASE_DATE = 58849

/** How a stored zone reads: a region name, or a fixed offset like -03:00. */
export function zoneLabel(zone: number): string {
  if (zone <= ONE_DAY * 2) {
    const minutes = zone - ONE_DAY
    const abs = Math.abs(minutes)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  }
  const name = TIME_ZONES[GMT - zone]
  if (!name) throw damaged(`unknown time zone ${zone}`)
  return name
}

/**
 * What ICU, and so Firebird, takes some legacy ids in its list to mean, for
 * runtimes whose Intl does not know them (JavaScriptCore, for one). The
 * SystemV zones that observe daylight saving follow rules of ICU's own and
 * have no equivalent here.
 */
const ALIASES: Record<string, string> = {
  ACT: 'Australia/Darwin',
  AET: 'Australia/Sydney',
  AGT: 'America/Argentina/Buenos_Aires',
  ART: 'Africa/Cairo',
  AST: 'America/Anchorage',
  BET: 'America/Sao_Paulo',
  BST: 'Asia/Dhaka',
  CAT: 'Africa/Maputo',
  CNT: 'America/St_Johns',
  CST: 'America/Chicago',
  CTT: 'Asia/Shanghai',
  EAT: 'Africa/Nairobi',
  ECT: 'Europe/Paris',
  IET: 'America/Indiana/Indianapolis',
  IST: 'Asia/Kolkata',
  JST: 'Asia/Tokyo',
  MIT: 'Pacific/Apia',
  NET: 'Asia/Yerevan',
  NST: 'Pacific/Auckland',
  PLT: 'Asia/Karachi',
  PNT: 'America/Phoenix',
  PRT: 'America/Puerto_Rico',
  PST: 'America/Los_Angeles',
  SST: 'Pacific/Guadalcanal',
  VST: 'Asia/Ho_Chi_Minh',
  Factory: 'Etc/GMT',
  'SystemV/AST4': 'Etc/GMT+4',
  'SystemV/CST6': 'Etc/GMT+6',
  'SystemV/EST5': 'Etc/GMT+5',
  'SystemV/HST10': 'Etc/GMT+10',
  'SystemV/MST7': 'Etc/GMT+7',
  'SystemV/PST8': 'Etc/GMT+8',
  'SystemV/YST9': 'Etc/GMT+9',
}

const formatters = new Map<string, Intl.DateTimeFormat | null>()

function tryFormatter(name: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: name,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
  } catch {
    return null
  }
}

function formatter(name: string): Intl.DateTimeFormat | null {
  let found = formatters.get(name)
  if (found === undefined) {
    const alias = ALIASES[name]
    found = tryFormatter(name) ?? (alias ? tryFormatter(alias) : null)
    formatters.set(name, found)
  }
  return found
}

/**
 * Minutes a zone is ahead of UTC at an instant, truncated the way Firebird
 * truncates ICU's milliseconds. Null when the runtime does not know the region.
 */
export function zoneOffset(zone: number, utcMs: number): number | null {
  if (zone === GMT) return 0
  if (zone <= ONE_DAY * 2) return zone - ONE_DAY
  const format = formatter(zoneLabel(zone))
  if (!format) return null
  const parts: Record<string, number> = {}
  for (const part of format.formatToParts(utcMs)) {
    parts[part.type] = Number(part.value)
  }
  const local = new Date(0)
  local.setUTCFullYear(
    parts.year as number,
    (parts.month as number) - 1,
    parts.day as number,
  )
  local.setUTCHours(parts.hour as number, parts.minute as number, parts.second)
  return Math.trunc((local.getTime() - Math.floor(utcMs / 1000) * 1000) / 60000)
}
