import { describe, it, expect } from 'vitest'
import { describeFbk, isFbkFile, FBK_HEADER_BYTES } from '../src/fbk/index.js'

/**
 * A gbak backup header, built byte by byte.
 *
 * No real backup is committed: the header record is short and fully specified,
 * so it is cheaper to write one than to carry somebody's database around.
 */
function header(
  attributes: Array<[att: number, value: Uint8Array]>,
  recordType = 0,
): Uint8Array {
  const bytes = [recordType]
  for (const [att, value] of attributes) {
    bytes.push(att, value.length, ...value)
  }
  bytes.push(0) // att_end
  return new Uint8Array(bytes)
}

const int32 = (n: number) =>
  new Uint8Array([
    n & 0xff,
    (n >> 8) & 0xff,
    (n >> 16) & 0xff,
    (n >> 24) & 0xff,
  ])

const ascii = (s: string) => new TextEncoder().encode(s)

/** The shape the real file opens with: format 9, page size 8192, then text. */
const SAMPLE = header([
  [2, int32(9)],
  [4, int32(1)],
  [5, int32(1)],
  [6, int32(8192)],
  [8, int32(1)],
  [7, ascii('C:\\CR\\LINKO_DB\\DB\\LINKO_DB.FDB')],
  [1, ascii('Mon Aug 25 13:24:31 2025')],
])

describe('isFbkFile', () => {
  it('recognises a gbak backup by its first record', () => {
    expect(isFbkFile(SAMPLE)).toBe(true)
  })

  it('needs only the first few bytes', () => {
    expect(isFbkFile(SAMPLE.subarray(0, FBK_HEADER_BYTES))).toBe(true)
  })

  it('refuses a truncated head', () => {
    expect(isFbkFile(SAMPLE.subarray(0, 3))).toBe(false)
    expect(isFbkFile(new Uint8Array())).toBe(false)
  })

  it('refuses a record that is not the backup header', () => {
    // rec_database, not rec_burp: a backup never opens with this.
    expect(isFbkFile(header([[2, int32(9)]], 1))).toBe(false)
  })

  it('refuses a first attribute that is not the format version', () => {
    expect(isFbkFile(header([[7, ascii('x')]]))).toBe(false)
  })

  it('refuses an implausible format version', () => {
    expect(isFbkFile(header([[2, int32(0)]]))).toBe(false)
    expect(isFbkFile(header([[2, int32(9999)]]))).toBe(false)
  })

  it('does not mistake a Firebird database for its backup', () => {
    // An .fdb opens with a page header, never with a zero byte.
    const page = new Uint8Array(32)
    page[0] = 0x01
    expect(isFbkFile(page)).toBe(false)
  })

  it('does not mistake a SQL script for a backup', () => {
    expect(isFbkFile(ascii('CREATE TABLE users (id INTEGER);'))).toBe(false)
  })
})

describe('describeFbk', () => {
  it('reads the format version, the source database and the backup date', () => {
    expect(describeFbk(SAMPLE)).toEqual({
      format: 9,
      pageSize: 8192,
      sourceFile: 'C:\\CR\\LINKO_DB\\DB\\LINKO_DB.FDB',
      backupDate: 'Mon Aug 25 13:24:31 2025',
    })
  })

  it('leaves out what the header does not carry', () => {
    expect(describeFbk(header([[2, int32(9)]]))).toEqual({ format: 9 })
  })

  it('returns nothing for a file that is not a backup', () => {
    expect(describeFbk(ascii('not a backup'))).toBeNull()
  })

  it('stops at the end of the header record', () => {
    // Anything after att_end belongs to the next record and must not be read
    // as though it were still the header.
    const withTrailer = new Uint8Array([
      ...SAMPLE,
      1, // rec_database
      7,
      2,
      ...ascii('xx'),
      0,
    ])
    expect(describeFbk(withTrailer)?.sourceFile).toBe(
      'C:\\CR\\LINKO_DB\\DB\\LINKO_DB.FDB',
    )
  })
})
