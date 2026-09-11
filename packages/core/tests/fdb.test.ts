import { describe, it, expect } from 'vitest'
import {
  applyDifferences,
  decompress,
  FdbReadError,
  isFdbFile,
  readHeader,
} from '../src/fdb/binary.js'
import {
  DTYPE,
  formatDate,
  formatTime,
  scaled,
  type Descriptor,
} from '../src/fdb/values.js'
import { readFdbDatabase, systemFormat } from '../src/fdb/index.js'

const hex = (text: string) =>
  Uint8Array.from(text.replace(/\s+/g, '').match(/../g) ?? [], (b) =>
    Number.parseInt(b, 16),
  )

/** The first 96 bytes of the user's DADOS.FDB: the header, no table data. */
const DADOS_HEADER = hex(`
  0100 3930 ab0b 2b00 0000 0000 0000 0000
  0040 0b80 0300 0000 0000 0000 140b 2b00
  150b 2b00 160b 2b00 0000 0201 5de7 0000
  1264 8d0b 3650 0000 0000 0000 1000 0200
  0200 6000 0000 0000 0100 0000 150b 2b00
  0000 0000 0000 0000 0000 0000 0000 0000
`)

function headerWith(patch: (bytes: Uint8Array) => void = () => {}): Uint8Array {
  const bytes = new Uint8Array(1024)
  bytes.set(DADOS_HEADER)
  patch(bytes)
  return bytes
}

describe('Firebird header', () => {
  it('reads the header of a Firebird 2.5 database', () => {
    const header = readHeader(headerWith())
    expect(header).toEqual({
      pageSize: 16384,
      odsMajor: 11,
      odsMinor: 2,
      odsMinorOriginal: 2,
      pagesPointer: 3,
      oldestTransaction: 0x2b0b14,
      nextTransaction: 0x2b0b16,
    })
    expect(isFdbFile(DADOS_HEADER)).toBe(true)
  })

  it.each([
    [12, /Firebird 3 \(ODS 12\)/],
    [13, /Firebird 4 or 5 \(ODS 13\)/],
    [10, /Firebird 1\.x \(ODS 10\)/],
  ])('refuses ODS %i by name', (major, message) => {
    const bytes = headerWith((b) => {
      b[18] = major
    })
    expect(isFdbFile(bytes)).toBe(true)
    expect(() => readHeader(bytes)).toThrow(message)
  })

  it('refuses an InterBase database', () => {
    const bytes = headerWith((b) => {
      b[19] = 0
    })
    expect(() => readHeader(bytes)).toThrow(/InterBase/)
  })

  it('refuses a multi-file database', () => {
    const bytes = headerWith((b) => {
      b[66] = 0x70
      b.set([3, 4, 0x61, 0x62, 0x63, 0x64], 96)
    })
    expect(() => readHeader(bytes)).toThrow(/other files/)
  })

  it('does not take other files for a database', () => {
    expect(isFdbFile(new TextEncoder().encode('SQLite format 3\0'))).toBe(false)
    expect(isFdbFile(new Uint8Array(20))).toBe(false)
  })
})

describe('record compression', () => {
  it('expands literals and runs', () => {
    expect([
      ...decompress(Int8Array.from([3, 1, 2, 3, -4, 9]) as never),
    ]).toEqual([1, 2, 3, 9, 9, 9, 9])
  })

  it('refuses input that overruns', () => {
    expect(() => decompress(Uint8Array.from([5, 1]))).toThrow(FdbReadError)
    expect(() => decompress(Uint8Array.from([0x80, 1]), 10)).toThrow(
      FdbReadError,
    )
  })

  it('rebuilds an older version from a difference string', () => {
    const newer = Uint8Array.from([1, 2, 3, 4])
    const diff = Int8Array.from([-2, 2, 9, 8])
    expect([...applyDifferences(newer, new Uint8Array(diff.buffer))]).toEqual([
      1, 2, 9, 8,
    ])
  })
})

describe('Firebird values', () => {
  it('writes dates from Modified Julian days', () => {
    expect(formatDate(0)).toBe('1858-11-17')
    expect(formatDate(40587)).toBe('1970-01-01')
    expect(formatTime(123_456_789)).toBe('03:25:45.6789')
  })

  it('keeps scaled numbers exact', () => {
    expect(scaled(-12345n, -2)).toBe('-123.45')
    expect(scaled(5n, -3)).toBe('0.005')
    expect(scaled(42n, 0)).toBe(42)
    expect(scaled(2n ** 62n, 0)).toBe(2n ** 62n)
  })
})

// ------------------------------------------------ a synthetic database

const PAGE = 4096
const WIN1252 = 53

type Value = null | number | string | Uint8Array

function encodeRow(format: Descriptor[], values: Value[]): Uint8Array {
  const data = new Uint8Array(
    Math.max(...format.map((d) => d.offset + d.length)),
  )
  const v = new DataView(data.buffer)
  values.forEach((value, i) => {
    const d = format[i] as Descriptor
    if (value === null) {
      data[i >> 3] = (data[i >> 3] as number) | (1 << (i & 7))
      return
    }
    if (typeof value === 'number') {
      if (d.dtype === DTYPE.long) v.setInt32(d.offset, value, true)
      else v.setInt16(d.offset, value, true)
      return
    }
    const bytes =
      typeof value === 'string' ? new TextEncoder().encode(value) : value
    if (d.dtype === DTYPE.text) {
      data.fill(32, d.offset, d.offset + d.length)
      data.set(bytes, d.offset)
    } else if (d.dtype === DTYPE.varying) {
      v.setUint16(d.offset, bytes.length, true)
      data.set(bytes, d.offset + 2)
    } else {
      data.set(bytes, d.offset)
    }
  })
  return data
}

/** Literal runs only: the reader must not depend on how data was compressed. */
function compress(data: Uint8Array): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < data.length; i += 127) {
    const chunk = data.subarray(i, i + 127)
    out.push(chunk.length, ...chunk)
  }
  return Uint8Array.from(out)
}

function record(
  data: Uint8Array,
  { tx = 0, flags = 0, format = 0, back = [0, 0] as [number, number] } = {},
): Uint8Array {
  const body = compress(data)
  const out = new Uint8Array(13 + body.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, tx, true)
  v.setUint32(4, back[0], true)
  v.setUint16(8, back[1], true)
  v.setUint16(10, flags, true)
  out[12] = format
  out.set(body, 13)
  return out
}

function blobRecord(segments: Uint8Array[], subType: number, charset: number) {
  const payload = segments.flatMap((s) => [
    s.length & 0xff,
    s.length >> 8,
    ...s,
  ])
  const out = new Uint8Array(28 + payload.length)
  const v = new DataView(out.buffer)
  v.setUint16(10, 16, true)
  v.setUint32(
    20,
    segments.reduce((n, s) => n + s.length, 0),
    true,
  )
  v.setUint16(24, subType, true)
  out[26] = charset
  out.set(payload, 28)
  return out
}

function blobId(relation: number, number: number): Uint8Array {
  const id = new Uint8Array(8)
  const v = new DataView(id.buffer)
  v.setUint16(0, relation, true)
  v.setUint32(4, number, true)
  return id
}

function buildDatabase(): Uint8Array {
  const pages: Uint8Array[] = []
  const alloc = () => pages.push(new Uint8Array(PAGE)) - 1
  alloc() // header
  const relations = [0, 1, 2, 5, 6, 8, 128]
  const pointer: Record<number, number> = {}
  const data: Record<number, number> = {}
  for (const r of relations) {
    pointer[r] = alloc()
    data[r] = alloc()
  }
  const tip = alloc()
  const at = (n: number) => new DataView((pages[n] as Uint8Array).buffer)

  const header = at(0)
  header.setUint8(0, 1)
  header.setUint16(16, PAGE, true)
  header.setUint16(18, 0x800b, true)
  header.setUint32(20, pointer[0] as number, true)
  header.setUint32(28, 5, true)
  header.setUint32(36, 10, true)
  header.setUint16(62, 2, true)
  header.setUint16(64, 2, true)
  header.setUint16(66, 96, true)

  // Transaction 5 committed, transaction 9 still active.
  at(tip).setUint8(0, 3)
  at(tip).setUint8(20 + (5 >> 2), 3 << ((5 & 3) * 2))

  const put = (relation: number, records: Uint8Array[]) => {
    const pp = at(pointer[relation] as number)
    pp.setUint8(0, 4)
    pp.setUint16(24, 1, true)
    pp.setUint16(26, relation, true)
    pp.setUint32(32, data[relation] as number, true)

    const page = pages[data[relation] as number] as Uint8Array
    const dp = at(data[relation] as number)
    dp.setUint8(0, 5)
    dp.setUint16(20, relation, true)
    dp.setUint16(22, records.length, true)
    let end = PAGE
    records.forEach((r, line) => {
      end -= r.length
      page.set(r, end)
      dp.setUint16(24 + line * 4, end, true)
      dp.setUint16(26 + line * 4, r.length, true)
    })
  }

  const T = [DTYPE.text, 31] as const
  const S = [DTYPE.short, 2] as const
  const L = [DTYPE.long, 4] as const
  const B = [DTYPE.blob, 8] as const
  const V = (n: number) => [DTYPE.varying, n] as const
  const PAGES = systemFormat([L, S, L, S], 2)
  const DATABASE = systemFormat([B, S, T, T], 2)
  const FIELDS = systemFormat(
    [
      T,
      T,
      B,
      B,
      B,
      B,
      B,
      B,
      S,
      S,
      S,
      S,
      B,
      B,
      B,
      S,
      B,
      S,
      V(127),
      S,
      S,
      S,
      S,
      S,
      S,
      S,
      S,
      S,
    ],
    2,
  )
  const RFR = systemFormat(
    [T, T, T, T, T, V(127), S, B, S, S, S, B, B, S, T, T, S, B, S],
    2,
  )
  const RELATIONS = systemFormat(
    [B, B, B, S, S, S, S, S, T, T, V(255), B, B, T, T, S, S],
    2,
  )
  const FORMATS = systemFormat([S, S, B], 2)

  put(0, [
    ...relations
      .filter((r) => r !== 0)
      .map((r) => record(encodeRow(PAGES, [pointer[r] as number, r, 0, 4]))),
    record(encodeRow(PAGES, [tip, 0, 0, 3])),
  ])
  put(1, [record(encodeRow(DATABASE, [null, null, null, 'WIN1252']))])

  const field = (
    name: string,
    type: number,
    {
      subType = 0,
      scale = 0,
      length = 4,
      charset = null as number | null,
      precision = null as number | null,
      computed = false,
    } = {},
  ) =>
    record(
      encodeRow(FIELDS, [
        name,
        null,
        null,
        null,
        computed ? blobId(8, 99) : null,
        null,
        null,
        null,
        length,
        scale,
        type,
        subType,
        null,
        null,
        null,
        0,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        charset,
        precision,
      ]),
    )
  put(2, [
    field('RDB$1', 8),
    field('RDB$2', 37, { length: 20, charset: WIN1252 }),
    field('RDB$3', 8, { scale: -2, subType: 1, precision: 9 }),
    field('RDB$4', 261, { subType: 1, length: 8 }),
    field('RDB$5', 8, { computed: true }),
  ])

  const column = (name: string, source: string, id: number) =>
    record(
      encodeRow(RFR, [
        name,
        'ITEMS',
        source,
        null,
        null,
        null,
        id,
        null,
        null,
        id,
        null,
        null,
        null,
        0,
        null,
        null,
        null,
        null,
        null,
      ]),
    )
  put(5, [
    column('ID', 'RDB$1', 0),
    column('NAME', 'RDB$2', 1),
    column('PRICE', 'RDB$3', 2),
    column('NOTE', 'RDB$4', 3),
    column('TOTAL', 'RDB$5', 4),
  ])

  const relation = (id: number, name: string, system: number, view = false) =>
    record(
      encodeRow(RELATIONS, [
        view ? blobId(8, 99) : null,
        null,
        null,
        id,
        system,
        null,
        1,
        null,
        name,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        view ? 1 : 0,
      ]),
    )
  put(6, [
    relation(0, 'RDB$PAGES', 1),
    relation(128, 'ITEMS', 0),
    relation(129, 'V_ITEMS', 0, true),
  ])

  const items: Descriptor[] = [
    { dtype: DTYPE.long, scale: 0, length: 4, subType: 0, offset: 4 },
    { dtype: DTYPE.varying, scale: 0, length: 22, subType: WIN1252, offset: 8 },
    { dtype: DTYPE.long, scale: -2, length: 4, subType: 0, offset: 32 },
    { dtype: DTYPE.blob, scale: 0, length: 8, subType: 1, offset: 40 },
  ]
  const descriptors = new Uint8Array(items.length * 12)
  const dv = new DataView(descriptors.buffer)
  items.forEach((d, i) => {
    dv.setUint8(i * 12, d.dtype)
    dv.setInt8(i * 12 + 1, d.scale)
    dv.setUint16(i * 12 + 2, d.length, true)
    dv.setInt16(i * 12 + 4, d.subType, true)
    dv.setUint32(i * 12 + 8, d.offset, true)
  })
  put(8, [
    record(encodeRow(FORMATS, [128, 1, blobId(8, 1)])),
    blobRecord([descriptors], 0, 0),
  ])

  const win1252 = (text: string) =>
    Uint8Array.from(text, (c) => c.charCodeAt(0))
  const older = encodeRow(items, [2, 'Old', null, null])
  const diff = Uint8Array.from([0xf8, older.length - 8, ...older.subarray(8)])
  put(128, [
    record(encodeRow(items, [1, win1252('Café'), 1250, blobId(128, 4)]), {
      tx: 5,
      format: 1,
    }),
    // Updated by transaction 9, which never committed: the committed version
    // is the delta at line 2.
    record(encodeRow(items, [2, 'New', null, null]), {
      tx: 9,
      format: 1,
      flags: 32,
      back: [data[128] as number, 2],
    }),
    record(diff, { tx: 5, format: 1, flags: 2 }),
    // Deleted by a committed transaction.
    record(new Uint8Array(0), { tx: 5, format: 1, flags: 1 }),
    blobRecord([win1252('Olá '), win1252('mundo')], 1, WIN1252),
    // Inserted by transaction 9 only.
    record(encodeRow(items, [3, 'Ghost', null, null]), { tx: 9, format: 1 }),
  ])

  const file = new Uint8Array(pages.length * PAGE)
  pages.forEach((page, i) => file.set(page, i * PAGE))
  return file
}

describe('readFdbDatabase', () => {
  it('reads committed rows with their exact values', () => {
    const { tables, unreadable } = readFdbDatabase(buildDatabase())

    expect(unreadable).toEqual([])
    expect(tables.map((t) => t.name)).toEqual(['ITEMS'])
    const [items] = tables
    expect(items?.columns.map((c) => [c.name, c.declaredType])).toEqual([
      ['ID', 'INTEGER'],
      ['NAME', 'VARCHAR(20)'],
      ['PRICE', 'NUMERIC(9,2)'],
      ['NOTE', 'BLOB SUB_TYPE TEXT'],
    ])
    expect(items?.rows).toEqual([
      [1, 'Café', '12.50', 'Olá mundo'],
      [2, 'Old', null, null],
    ])
    expect(items?.rowCount).toBe(2)
    expect(items?.createStatement).toContain('"PRICE" NUMERIC(9,2)')
  })

  it('counts every row but keeps only the limit', () => {
    const [items] = readFdbDatabase(buildDatabase(), { rowLimit: 1 }).tables
    expect(items?.rows).toHaveLength(1)
    expect(items?.rowCount).toBe(2)
  })

  it('refuses a truncated file without quoting it', () => {
    const bytes = buildDatabase().subarray(0, PAGE * 3)
    expect(() => readFdbDatabase(bytes)).toThrow(
      'This Firebird database is damaged or incomplete.',
    )
  })
})
