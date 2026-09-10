import { describe, it, expect } from 'vitest'
import { convertTimestamp } from '../src/utilities/timestamp.js'
import { DataFormatError } from '../src/records/index.js'

describe('convertTimestamp', () => {
  it('reads Unix seconds', () => {
    expect(convertTimestamp('1700000000')).toEqual({
      read: 'seconds',
      seconds: 1700000000,
      milliseconds: 1700000000000,
      iso: '2023-11-14T22:13:20.000Z',
    })
  })

  it('reads Unix milliseconds', () => {
    expect(convertTimestamp('1700000000123')).toEqual({
      read: 'milliseconds',
      seconds: 1700000000,
      milliseconds: 1700000000123,
      iso: '2023-11-14T22:13:20.123Z',
    })
  })

  it('reads ISO 8601 with its offset', () => {
    expect(convertTimestamp('2023-11-14T19:13:20-03:00')).toMatchObject({
      read: 'iso',
      iso: '2023-11-14T22:13:20.000Z',
      seconds: 1700000000,
    })
  })

  it('reads ISO 8601 without an offset as UTC, and says so', () => {
    expect(convertTimestamp('2023-11-14T22:13:20')).toMatchObject({
      read: 'iso-assumed-utc',
      iso: '2023-11-14T22:13:20.000Z',
    })
    expect(convertTimestamp('2023-11-14')).toMatchObject({
      read: 'iso-assumed-utc',
      iso: '2023-11-14T00:00:00.000Z',
    })
  })

  it('reads the epoch and a moment before it', () => {
    expect(convertTimestamp('0').iso).toBe('1970-01-01T00:00:00.000Z')
    expect(convertTimestamp('-86400')).toMatchObject({
      seconds: -86400,
      iso: '1969-12-31T00:00:00.000Z',
    })
  })

  it('ignores surrounding whitespace', () => {
    expect(convertTimestamp('  1700000000\n').seconds).toBe(1700000000)
  })

  it('refuses anything that is not one of the three', () => {
    for (const bad of ['tomorrow', '', '1.5', '99999999999999999999']) {
      expect(() => convertTimestamp(bad)).toThrow(DataFormatError)
    }
  })
})
