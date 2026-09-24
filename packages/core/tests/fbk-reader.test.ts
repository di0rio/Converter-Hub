import { constants, deflateSync } from 'node:zlib'
import { describe, it, expect } from 'vitest'
import { FbkReadError, readFbkDatabase } from '../src/fbk/index.js'

/**
 * A gbak backup, written byte by byte the way gbak writes one: a header
 * record, metadata records, then each table's rows as XDR, run-length encoded,
 * with their blobs after them.
 */
const ascii = (s: string) => [...new TextEncoder().encode(s)]
const le32 = (n: number) => [
  n & 0xff,
  (n >> 8) & 0xff,
  (n >> 16) & 0xff,
  (n >>> 24) & 0xff,
]
const be32 = (n: number) => [
  (n >>> 24) & 0xff,
  (n >> 16) & 0xff,
  (n >> 8) & 0xff,
  n & 0xff,
]
const pad4 = (bytes: number[]) => [
  ...bytes,
  ...Array((4 - (bytes.length & 3)) & 3).fill(0),
]

const text = (att: number, s: string) => [att, ascii(s).length, ...ascii(s)]
const int = (att: number, n: number) => [att, 4, ...le32(n)]
const blobAttr = (att: number, bytes: number[]) => [
  att,
  4,
  ...le32(bytes.length),
  ...bytes,
]

/** gbak's run-length encoding, literals only: enough to exercise the reader. */
function rle(bytes: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < bytes.length; i += 127) {
    const chunk = bytes.slice(i, i + 127)
    out.push(chunk.length, ...chunk)
  }
  return out
}

function row(xdr: number[]): number[] {
  const packed = rle(xdr)
  return [6, ...int(1, 64), ...int(17, xdr.length), 2, ...packed]
}

const WIN1252 = 53

function header(extra: number[] = [], transportable = 1): number[] {
  return [
    0,
    ...int(2, 11),
    ...int(4, 1),
    ...int(5, transportable),
    ...extra,
    ...int(6, 0x8000),
    ...text(7, 'items.fdb'),
    ...text(1, 'Thu Sep 24 12:00:00 2026'),
    0,
  ]
}

function body(): number[] {
  // 'ação longa' in WIN1252, the column's character set.
  const note = [0x61, 0xe7, 0xe3, 0x6f, 0x20, 0x6c, 0x6f, 0x6e, 0x67, 0x61]
  return [
    // rec_database, with a blob description to be skipped by its length.
    1,
    ...blobAttr(6, ascii('a description')),
    ...text(11, 'WIN1252'),
    0,
    // Global fields.
    2,
    ...text(1, 'D_ID'),
    ...int(8, 8),
    ...int(10, 4),
    0,
    2,
    ...text(1, 'D_NAME'),
    ...int(8, 37),
    ...int(10, 10),
    ...int(41, 10),
    ...int(42, WIN1252),
    0,
    2,
    ...text(1, 'D_PRICE'),
    ...int(8, 16),
    ...int(10, 8),
    ...int(11, -2),
    ...int(44, 18),
    ...int(9, 1),
    0,
    2,
    ...text(1, 'D_NOTE'),
    ...int(8, 261),
    ...int(9, 1),
    ...int(42, WIN1252),
    0,
    // An exception whose message has a two-byte length.
    30,
    ...text(1, 'E_LONG'),
    5,
    ...[44, 1],
    ...Array(300).fill(0x61),
    0,
    // A function and its arguments, closed by rec_function_end.
    15,
    ...text(1, 'F'),
    0,
    16,
    ...text(1, 'A'),
    0,
    17,
    // The table and its columns, in gbak's order rather than the declared one.
    3,
    ...text(1, 'ITEMS'),
    0,
    4,
    ...text(1, 'PRICE'),
    ...text(2, 'D_PRICE'),
    ...int(8, 16),
    ...int(10, 8),
    ...int(11, -2),
    ...int(13, 2),
    ...int(22, 2),
    0,
    4,
    ...text(1, 'ID'),
    ...text(2, 'D_ID'),
    ...int(8, 8),
    ...int(10, 4),
    ...int(13, 0),
    ...int(22, 0),
    ...int(38, 1),
    0,
    4,
    ...text(1, 'NAME'),
    ...text(2, 'D_NAME'),
    ...int(8, 37),
    ...int(10, 10),
    ...int(42, WIN1252),
    ...int(13, 1),
    ...int(22, 1),
    0,
    4,
    ...text(1, 'NOTE'),
    ...text(2, 'D_NOTE'),
    ...int(8, 261),
    ...int(9, 1),
    ...int(42, WIN1252),
    ...int(13, 3),
    ...int(22, 3),
    0,
    9,
    // Its rows.
    8,
    ...text(1, 'ITEMS'),
    0,
    ...row([
      ...[0, 0, 0, 0, 0, 0, 0x30, 0x39], // PRICE 123.45 as int64
      ...be32(7), // ID
      ...be32(3),
      ...pad4([0x63, 0xe3, 0x6f]), // NAME 'cão' in WIN1252
      ...Array(8).fill(0), // NOTE's blob id, meaningless here
      ...be32(0),
      ...be32(0),
      ...be32(0),
      ...be32(0), // no nulls
    ]),
    7,
    ...int(3, 3),
    ...int(4, 0),
    ...int(5, 2),
    ...int(6, 8),
    7,
    ...[4, 0],
    ...note.slice(0, 4),
    ...[6, 0],
    ...note.slice(4),
    ...row([
      ...Array(8).fill(0),
      ...be32(8),
      ...be32(0),
      ...Array(8).fill(0),
      ...be32(-1),
      ...be32(0),
      ...be32(0),
      ...be32(-1), // PRICE and NOTE null
    ]),
    5,
    ...text(1, 'ITEMS_PK'),
    0, // an index, inside the table's data
    9,
    10,
  ]
}

describe('readFbkDatabase', () => {
  it('reads a table out of a backup, in declared column order', async () => {
    const db = await readFbkDatabase(new Uint8Array([...header(), ...body()]))
    expect(db.unreadable).toEqual([])
    const [items] = db.tables
    expect(
      items?.columns.map((c) => [c.name, c.declaredType, c.notNull]),
    ).toEqual([
      ['ID', 'INTEGER', true],
      ['NAME', 'VARCHAR(10)', false],
      ['PRICE', 'NUMERIC(18,2)', false],
      ['NOTE', 'BLOB SUB_TYPE TEXT', false],
    ])
    expect(items?.rows).toEqual([
      [7, 'cão', '123.45', 'ação longa'],
      [8, '', null, null],
    ])
    expect(items?.rowCount).toBe(2)
  })

  it('stops keeping rows at the limit but still counts them', async () => {
    const db = await readFbkDatabase(new Uint8Array([...header(), ...body()]), {
      rowLimit: 1,
    })
    expect(db.tables[0]?.rows).toHaveLength(1)
    expect(db.tables[0]?.rowCount).toBe(2)
  })

  it('reads a gbak -zip backup, whose stream ends in a sync flush and padding', async () => {
    const zipped = deflateSync(new Uint8Array(body()), {
      finishFlush: constants.Z_SYNC_FLUSH,
    })
    const bytes = new Uint8Array([
      ...header(int(10, 1)),
      ...zipped,
      ...Array(300).fill(0),
    ])
    const db = await readFbkDatabase(bytes)
    expect(db.tables[0]?.rows[0]?.[0]).toBe(7)
  })

  it('refuses a backup cut short, and one it cannot read', async () => {
    const whole = [...header(), ...body()]
    await expect(
      readFbkDatabase(new Uint8Array(whole.slice(0, whole.length - 40))),
    ).rejects.toThrow(FbkReadError)
    await expect(
      readFbkDatabase(new Uint8Array(header(text(12, 'DbCrypt')))),
    ).rejects.toThrow(/encrypted/)
    await expect(
      readFbkDatabase(new Uint8Array([...header([], 0), ...body()])),
    ).rejects.toThrow(/-nt/)
  })
})
