import { DataFormatError } from '../records/index.js'

/**
 * One moment, written as Unix seconds, Unix milliseconds and ISO 8601 UTC.
 *
 * The input may be any of the three. A whole number is seconds below 1e11 —
 * the year 5138 in seconds, a value every millisecond timestamp since 1973
 * exceeds — and milliseconds from there. An ISO 8601 date-time carrying an
 * offset is read at that offset; one without an offset is read as UTC, and the
 * result says so. Nothing is read in the machine's local timezone.
 */

export type TimestampRead =
  | 'seconds'
  | 'milliseconds'
  | 'iso'
  | 'iso-assumed-utc'

export type Timestamp = {
  read: TimestampRead
  seconds: number
  milliseconds: number
  iso: string
}

const SECONDS_LIMIT = 1e11

const ISO =
  /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?))?(Z|[+-]\d{2}:?\d{2})?$/i

function refuse(): DataFormatError {
  return new DataFormatError(
    'This is not a Unix timestamp or an ISO 8601 date.',
  )
}

function readIso(text: string): { read: TimestampRead; milliseconds: number } {
  const match = ISO.exec(text)
  if (!match) throw refuse()

  const [, date, time, offset] = match
  if (!time) {
    // A date alone is midnight UTC by the standard, offset or not.
    return { read: offset ? 'iso' : 'iso-assumed-utc', milliseconds: Date.parse(`${date}T00:00:00${offset?.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2') ?? 'Z'}`) }
  }

  const zone = offset
    ? offset.toUpperCase() === 'Z'
      ? 'Z'
      : offset.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')
    : 'Z'
  return {
    read: offset ? 'iso' : 'iso-assumed-utc',
    milliseconds: Date.parse(`${date}T${time}${zone}`),
  }
}

export function convertTimestamp(input: string): Timestamp {
  const text = input.trim()

  let read: TimestampRead
  let milliseconds: number
  if (/^-?\d+$/.test(text)) {
    const value = Number(text)
    read = Math.abs(value) < SECONDS_LIMIT ? 'seconds' : 'milliseconds'
    milliseconds = read === 'seconds' ? value * 1000 : value
  } else {
    ;({ read, milliseconds } = readIso(text))
  }

  const date = new Date(milliseconds)
  if (!Number.isFinite(milliseconds) || Number.isNaN(date.getTime())) {
    throw refuse()
  }

  return {
    read,
    seconds: Math.floor(milliseconds / 1000),
    milliseconds,
    iso: date.toISOString(),
  }
}
