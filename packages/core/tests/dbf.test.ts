import { describe, it, expect } from 'vitest'
import {
  DbfReadError,
  groupDbfFiles,
  isDbfFile,
  readDbfDatabase,
  readDbfTable,
  tableName,
} from '../src/dbf/index.js'
import { readDbfHeader, writtenBy } from '../src/dbf/header.js'
import { DEFAULT_ENCODING, Text, encodingFor } from '../src/dbf/values.js'

interface FieldSpec {
  name: string
  type: string
  length: number
  decimals?: number
  flags?: number
}

const ascii = (text: string) =>
  Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff)

function pad(text: string, width: number): Uint8Array {
  const bytes = new Uint8Array(width).fill(0x20)
  bytes.set(ascii(text).subarray(0, width))
  return bytes
}

function shortened(text: string, width: number): Uint8Array {
  const bytes = pad(text, width)
  bytes[width - 1] = text.length
  return bytes
}

function right(text: string, width: number): Uint8Array {
  const bytes = new Uint8Array(width).fill(0x20)
  const value = ascii(text).subarray(0, width)
  bytes.set(value, width - value.length)
  return bytes
}

interface TableSpec {
  version?: number
  languageDriver?: number
  fields: FieldSpec[]
  /** One entry per record: the field payloads, without the deletion marker. */
  records: (Uint8Array | number[])[]
  deleted?: number[]
  /** Write a record count that does not match the records written. */
  claimRecords?: number
  flags?: number
}

function buildDbf(spec: TableSpec): Uint8Array {
  const fields = spec.fields
  const recordLength =
    1 + fields.reduce((total, field) => total + field.length, 0)
  const headerLength = 32 + fields.length * 32 + 1
  const bytes = new Uint8Array(
    headerLength + spec.records.length * recordLength + 1,
  )
  const view = new DataView(bytes.buffer)

  bytes[0] = spec.version ?? 0x03
  bytes[1] = 125
  bytes[2] = 10
  bytes[3] = 16
  view.setUint32(4, spec.claimRecords ?? spec.records.length, true)
  view.setUint16(8, headerLength, true)
  view.setUint16(10, recordLength, true)
  bytes[28] = spec.flags ?? 0
  bytes[29] = spec.languageDriver ?? 0

  fields.forEach((field, index) => {
    const at = 32 + index * 32
    bytes.set(ascii(field.name).subarray(0, 10), at)
    bytes[at + 11] = field.type.charCodeAt(0)
    bytes[at + 16] = field.length & 0xff
    bytes[at + 17] = field.decimals ?? 0
    bytes[at + 18] = field.flags ?? 0
  })
  bytes[32 + fields.length * 32] = 0x0d

  spec.records.forEach((record, index) => {
    const at = headerLength + index * recordLength
    bytes[at] = spec.deleted?.includes(index) ? 0x2a : 0x20
    bytes.set(
      record instanceof Uint8Array ? record : Uint8Array.from(record),
      at + 1,
    )
  })
  bytes[bytes.length - 1] = 0x1a
  return bytes
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const le32 = (value: number) => {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setInt32(0, value, true)
  return bytes
}

const f64 = (value: number) => {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setFloat64(0, value, true)
  return bytes
}

const i64 = (value: bigint) => {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigInt64(0, value, true)
  return bytes
}

function readOne(bytes: Uint8Array, memo?: Uint8Array) {
  return readDbfTable({ name: 'PEOPLE.DBF', bytes, memo })
}

describe('isDbfFile', () => {
  it('accepts a dBase III table', () => {
    const bytes = buildDbf({
      fields: [{ name: 'NAME', type: 'C', length: 4 }],
      records: [pad('anne', 4)],
    })
    expect(isDbfFile(bytes.subarray(0, 32))).toBe(true)
  })

  it('accepts a dBase II table', () => {
    const bytes = new Uint8Array(521 + 9)
    bytes[0] = 0x02
    bytes[3] = 10
    bytes[4] = 16
    new DataView(bytes.buffer).setUint16(6, 9, true)
    expect(isDbfFile(bytes.subarray(0, 32))).toBe(true)
  })

  it('rejects a short head, an unknown version and an impossible date', () => {
    expect(isDbfFile(new Uint8Array(8))).toBe(false)
    const bytes = buildDbf({
      fields: [{ name: 'A', type: 'C', length: 1 }],
      records: [],
    })
    const unknown = bytes.slice(0, 32)
    unknown[0] = 0x11
    expect(isDbfFile(unknown)).toBe(false)
    const impossible = bytes.slice(0, 32)
    impossible[2] = 13
    expect(isDbfFile(impossible)).toBe(false)
  })

  it('rejects a header with no room for a field descriptor', () => {
    const bytes = buildDbf({
      fields: [{ name: 'A', type: 'C', length: 1 }],
      records: [],
    })
    new DataView(bytes.buffer).setUint16(8, 40, true)
    expect(isDbfFile(bytes.subarray(0, 32))).toBe(false)
  })
})

describe('readDbfHeader', () => {
  it('refuses a file that is not a table', () => {
    expect(() => readDbfHeader(new Uint8Array(64))).toThrow(DbfReadError)
  })

  it('widens a character field past 255 bytes with the decimal byte', () => {
    const bytes = buildDbf({
      fields: [{ name: 'NOTE', type: 'C', length: 44, decimals: 1 }],
      records: [],
    })
    // The builder wrote length 44 and decimals 1, which means 44 + 256.
    new DataView(bytes.buffer).setUint16(10, 301, true)
    const header = readDbfHeader(bytes)
    expect(header.fields[0]?.length).toBe(300)
    expect(header.fields[0]?.decimals).toBe(0)
  })

  it('refuses fields wider than the record', () => {
    const bytes = buildDbf({
      fields: [{ name: 'NAME', type: 'C', length: 10 }],
      records: [],
    })
    new DataView(bytes.buffer).setUint16(10, 4, true)
    expect(() => readDbfHeader(bytes)).toThrow(/damaged or incomplete/)
  })

  it('names what wrote the table', () => {
    expect(writtenBy(0x02)).toBe('dBase II')
    expect(writtenBy(0x03)).toBe('dBase III+ or FoxBASE+')
    expect(writtenBy(0x30)).toBe('FoxPro')
    expect(writtenBy(0x8b)).toBe('dBase IV')
    expect(writtenBy(0x00)).toBeUndefined()
  })
})

describe('field types', () => {
  it('reads characters, numbers, dates and logicals', () => {
    const table = readOne(
      buildDbf({
        fields: [
          { name: 'NAME', type: 'C', length: 6 },
          { name: 'AGE', type: 'N', length: 4 },
          { name: 'RATE', type: 'N', length: 7, decimals: 2 },
          { name: 'BORN', type: 'D', length: 8 },
          { name: 'OK', type: 'L', length: 1 },
        ],
        records: [
          concat(
            pad('anne', 6),
            right('41', 4),
            right('12.50', 7),
            ascii('19840229'),
            ascii('T'),
          ),
          concat(
            pad('bo', 6),
            right('', 4),
            right('-0.25', 7),
            ascii('        '),
            ascii('?'),
          ),
          concat(
            pad('cleo', 6),
            right('****', 4),
            right('3', 7),
            ascii('00000000'),
            ascii('N'),
          ),
        ],
      }),
    )

    expect(table.name).toBe('PEOPLE')
    expect(table.columns.map((c) => c.declaredType)).toEqual([
      'CHAR(6)',
      'NUMERIC(4)',
      'NUMERIC(7,2)',
      'DATE',
      'LOGICAL',
    ])
    expect(table.rows).toEqual([
      ['anne', 41, 12.5, '1984-02-29', 1],
      ['bo', null, -0.25, null, null],
      ['cleo', null, 3, null, 0],
    ])
  })

  it('keeps a whole number too large for a double as a bigint', () => {
    const table = readOne(
      buildDbf({
        fields: [{ name: 'BIG', type: 'N', length: 20 }],
        records: [right('123456789012345678', 20)],
      }),
    )
    expect(table.rows[0]?.[0]).toBe(123456789012345678n)
  })

  it('reads the Visual FoxPro integer, double, currency and datetime types', () => {
    const table = readOne(
      buildDbf({
        version: 0x30,
        fields: [
          { name: 'ID', type: 'I', length: 4 },
          { name: 'SIZE', type: 'B', length: 8 },
          { name: 'PRICE', type: 'Y', length: 8 },
          { name: 'SEEN', type: 'T', length: 8 },
          { name: 'EMPTY', type: 'T', length: 8 },
        ],
        records: [
          concat(
            le32(-7),
            f64(2.5),
            i64(123_4500n),
            concat(le32(2_451_545), le32(43_200_500)),
            new Uint8Array(8),
          ),
        ],
      }),
    )
    expect(table.columns.map((c) => c.declaredType)).toEqual([
      'INTEGER',
      'DOUBLE',
      'CURRENCY',
      'TIMESTAMP',
      'TIMESTAMP',
    ])
    expect(table.rows[0]).toEqual([
      -7,
      2.5,
      123.45,
      '2000-01-01 12:00:00.500',
      null,
    ])
  })

  it('keeps a currency value too large for a double exact', () => {
    const table = readOne(
      buildDbf({
        version: 0x30,
        fields: [{ name: 'PRICE', type: 'Y', length: 8 }],
        records: [i64(-92_233_720_368_547_758n)],
      }),
    )
    expect(table.rows[0]?.[0]).toBe('-9223372036854.7758')
  })

  it('reads a binary character field as bytes', () => {
    const table = readOne(
      buildDbf({
        version: 0x30,
        fields: [{ name: 'RAW', type: 'C', length: 3, flags: 0x04 }],
        records: [Uint8Array.from([0x00, 0xff, 0x7f])],
      }),
    )
    expect(table.rows[0]?.[0]).toEqual(Uint8Array.from([0x00, 0xff, 0x7f]))
  })
})

describe('records', () => {
  it('leaves out deleted records but can include them', () => {
    const spec: TableSpec = {
      fields: [{ name: 'NAME', type: 'C', length: 4 }],
      records: [pad('anne', 4), pad('bo', 4), pad('cleo', 4)],
      deleted: [1],
    }
    expect(readOne(buildDbf(spec)).rows).toEqual([['anne'], ['cleo']])
    const all = readDbfTable(
      { name: 'PEOPLE.DBF', bytes: buildDbf(spec) },
      { includeDeleted: true },
    )
    expect(all.rows).toEqual([['anne'], ['bo'], ['cleo']])
  })

  it('counts every record but keeps only the row limit', () => {
    const table = readDbfTable(
      {
        name: 'PEOPLE.DBF',
        bytes: buildDbf({
          fields: [{ name: 'NAME', type: 'C', length: 4 }],
          records: [pad('anne', 4), pad('bo', 4), pad('cleo', 4)],
        }),
      },
      { rowLimit: 2 },
    )
    expect(table.rowCount).toBe(3)
    expect(table.rows).toHaveLength(2)
  })

  it('reads the records a truncated file still holds', () => {
    const bytes = buildDbf({
      fields: [{ name: 'NAME', type: 'C', length: 4 }],
      records: [pad('anne', 4), pad('bo', 4)],
      claimRecords: 9,
    })
    expect(readOne(bytes).rows).toEqual([['anne'], ['bo']])
  })

  it('reads a file that ends without the end-of-file marker', () => {
    const bytes = buildDbf({
      fields: [{ name: 'NAME', type: 'C', length: 4 }],
      records: [pad('anne', 4)],
    })
    expect(readOne(bytes.subarray(0, bytes.length - 1)).rows).toEqual([
      ['anne'],
    ])
  })
})

describe('memo files', () => {
  it('reads a dBase III memo, which ends at the first 0x1a', () => {
    const memo = new Uint8Array(1024)
    memo.set(ascii('a long note'), 512)
    memo[512 + 11] = 0x1a
    const table = readOne(
      buildDbf({
        version: 0x83,
        fields: [
          { name: 'NAME', type: 'C', length: 4 },
          { name: 'NOTE', type: 'M', length: 10 },
        ],
        records: [
          concat(pad('anne', 4), right('1', 10)),
          concat(pad('bo', 4), pad('', 10)),
        ],
      }),
      memo,
    )
    expect(table.columns[1]?.declaredType).toBe('MEMO')
    expect(table.rows).toEqual([
      ['anne', 'a long note'],
      ['bo', null],
    ])
  })

  it('reads a dBase IV memo, which carries its own length', () => {
    const memo = new Uint8Array(1024)
    const head = new DataView(memo.buffer)
    head.setUint16(20, 512, true)
    head.setUint16(512, 0xffff, true)
    head.setUint16(514, 8, true)
    head.setUint32(516, 8 + 5, true)
    memo.set(ascii('hello'), 520)
    const table = readOne(
      buildDbf({
        version: 0x8b,
        fields: [{ name: 'NOTE', type: 'M', length: 10 }],
        records: [right('1', 10)],
      }),
      memo,
    )
    expect(table.rows).toEqual([['hello']])
  })

  it('reads a FoxPro memo, with its block size and length big-endian', () => {
    const memo = new Uint8Array(64 + 64)
    const head = new DataView(memo.buffer)
    head.setUint16(6, 64, false)
    head.setUint32(64, 1, false)
    head.setUint32(68, 5, false)
    memo.set(ascii('olive'), 72)
    const table = readOne(
      buildDbf({
        version: 0xf5,
        fields: [{ name: 'NOTE', type: 'M', length: 4 }],
        records: [le32(1)],
      }),
      memo,
    )
    expect(table.rows).toEqual([['olive']])
  })

  it('keeps a FoxPro object block as bytes', () => {
    const memo = new Uint8Array(64 + 64)
    const head = new DataView(memo.buffer)
    head.setUint16(6, 64, false)
    head.setUint32(64, 2, false)
    head.setUint32(68, 2, false)
    memo.set(Uint8Array.from([0x01, 0x02]), 72)
    const table = readOne(
      buildDbf({
        version: 0x30,
        fields: [{ name: 'BLOB', type: 'G', length: 4 }],
        records: [le32(1)],
      }),
      memo,
    )
    expect(table.rows[0]?.[0]).toEqual(Uint8Array.from([0x01, 0x02]))
  })

  it('reads the table with empty memo values when no memo file is given', () => {
    const table = readOne(
      buildDbf({
        version: 0x83,
        fields: [
          { name: 'NAME', type: 'C', length: 4 },
          { name: 'NOTE', type: 'M', length: 10 },
        ],
        records: [concat(pad('anne', 4), right('1', 10))],
      }),
    )
    expect(table.rows).toEqual([['anne', null]])
  })
})

describe('Visual FoxPro null flags', () => {
  it('reads null values and the length of a varchar', () => {
    const bytes = buildDbf({
      version: 0x32,
      fields: [
        { name: 'NOTE', type: 'V', length: 6 },
        { name: 'AGE', type: 'I', length: 4, flags: 0x02 },
        { name: '_NullFlag', type: '0', length: 1, flags: 0x05 },
      ],
      records: [
        // Bit 0 says the varchar carries a length; bit 1 says AGE is null.
        // A shortened varchar keeps that length in its last byte.
        concat(shortened('ab', 6), le32(0), Uint8Array.from([0b11])),
        concat(pad('full!!', 6), le32(41), Uint8Array.from([0b00])),
      ],
    })
    const table = readOne(bytes)

    expect(table.columns.map((c) => c.name)).toEqual(['NOTE', 'AGE'])
    expect(table.columns.map((c) => c.declaredType)).toEqual([
      'VARCHAR(6)',
      'INTEGER',
    ])
    expect(table.rows).toEqual([
      ['ab', null],
      ['full!!', 41],
    ])
  })
})

describe('dBase II', () => {
  it('reads its 16-byte field descriptors and fixed data offset', () => {
    const bytes = new Uint8Array(521 + 2 * 11)
    const view = new DataView(bytes.buffer)
    bytes[0] = 0x02
    view.setUint16(1, 2, true)
    bytes[3] = 10
    bytes[4] = 16
    bytes[5] = 125
    view.setUint16(6, 11, true)
    bytes.set(ascii('NAME'), 8)
    bytes[8 + 11] = 'C'.charCodeAt(0)
    bytes[8 + 12] = 6
    bytes.set(ascii('AGE'), 24)
    bytes[24 + 11] = 'N'.charCodeAt(0)
    bytes[24 + 12] = 4
    bytes[40] = 0x0d
    bytes.set(
      concat(new Uint8Array([0x20]), pad('anne', 6), right('41', 4)),
      521,
    )
    bytes.set(concat(new Uint8Array([0x20]), pad('bo', 6), right('7', 4)), 532)

    const table = readDbfTable({ name: 'OLD.DBF', bytes })
    expect(table.rows).toEqual([
      ['anne', 41],
      ['bo', 7],
    ])
  })
})

describe('column names', () => {
  it('fills in a name for an unnamed field and makes repeats unique', () => {
    const table = readOne(
      buildDbf({
        fields: [
          { name: 'NAME', type: 'C', length: 2 },
          { name: 'name', type: 'C', length: 2 },
          { name: '', type: 'C', length: 2 },
        ],
        records: [pad('ab', 6)],
      }),
    )
    expect(table.columns.map((c) => c.name)).toEqual([
      'NAME',
      'name_2',
      'column_3',
    ])
  })

  it('takes the table name from the file name', () => {
    expect(tableName('/data/CLIENTES.DBF')).toBe('CLIENTES')
    expect(tableName('C:\\dados\\ANIMAL2.dbf')).toBe('ANIMAL2')
    expect(tableName('.dbf')).toBe('table')
  })
})

describe('encodings', () => {
  it('reads an OEM code page the platform does not carry', () => {
    const table = readOne(
      buildDbf({
        languageDriver: 0x24,
        fields: [{ name: 'NAME', type: 'C', length: 4 }],
        records: [Uint8Array.from([0x85, 0x87, 0x84, 0x20])],
      }),
    )
    expect(table.rows[0]?.[0]).toBe('àçã')
  })

  it('falls back to windows-1252 when the table says nothing', () => {
    expect(encodingFor(0, undefined)).toBe(DEFAULT_ENCODING)
    expect(encodingFor(0x02, undefined)).toBe(850)
    expect(encodingFor(0x02, 'windows-1252')).toBe('windows-1252')
  })

  it('falls back to windows-1252 for a label the platform refuses', () => {
    expect(new Text('not-an-encoding').decode(ascii('plain'))).toBe('plain')
    expect(new Text(1).decode(Uint8Array.from([0x41]))).toBe('A')
  })

  it('reads the encoding an option names instead of the table byte', () => {
    const bytes = buildDbf({
      languageDriver: 0x03,
      fields: [{ name: 'NAME', type: 'C', length: 3 }],
      records: [Uint8Array.from([0x85, 0x87, 0x84])],
    })
    const table = readDbfTable({ name: 'P.DBF', bytes }, { encoding: 860 })
    expect(table.rows[0]?.[0]).toBe('àçã')
  })
})

describe('readDbfDatabase', () => {
  const people = buildDbf({
    fields: [{ name: 'NAME', type: 'C', length: 4 }],
    records: [pad('anne', 4)],
  })

  it('reads one table per source', () => {
    const database = readDbfDatabase([
      { name: 'PEOPLE.DBF', bytes: people },
      { name: 'PETS.DBF', bytes: people },
    ])
    expect(database.tables.map((t) => t.name)).toEqual(['PEOPLE', 'PETS'])
    expect(database.unreadable).toEqual([])
  })

  it('lists a table it cannot read and keeps the others', () => {
    const database = readDbfDatabase([
      { name: 'PEOPLE.DBF', bytes: people },
      { name: 'BROKEN.DBF', bytes: new Uint8Array(64) },
    ])
    expect(database.tables.map((t) => t.name)).toEqual(['PEOPLE'])
    expect(database.unreadable).toEqual([
      {
        name: 'BROKEN',
        reason: 'damaged',
        detail: 'not a dBase or FoxPro table',
      },
    ])
  })

  it('refuses an empty selection and one with nothing readable', () => {
    expect(() => readDbfDatabase([])).toThrow(/No dBase table/)
    expect(() =>
      readDbfDatabase([{ name: 'BROKEN.DBF', bytes: new Uint8Array(64) }]),
    ).toThrow(/damaged or incomplete/)
    expect(() =>
      readDbfDatabase([
        { name: 'A.DBF', bytes: new Uint8Array(64) },
        { name: 'B.DBF', bytes: new Uint8Array(64) },
      ]),
    ).toThrow(/None of the selected/)
  })
})

describe('groupDbfFiles', () => {
  it('pairs each table with its memo file and ignores index files', () => {
    const groups = groupDbfFiles([
      { name: 'ORDEM.DBF' },
      { name: 'ANIMAL2.DBF' },
      { name: 'animal2.dbt' },
      { name: 'INDANI2.cdx' },
    ])
    expect(groups.map((g) => [g.table.name, g.memo?.name])).toEqual([
      ['ANIMAL2.DBF', 'animal2.dbt'],
      ['ORDEM.DBF', undefined],
    ])
  })

  it('pairs a FoxPro table with its .fpt', () => {
    const groups = groupDbfFiles([
      { name: 'RECEITA.FPT' },
      { name: 'RECEITA.DBF' },
    ])
    expect(groups[0]?.memo?.name).toBe('RECEITA.FPT')
  })

  it('refuses a selection with no table in it', () => {
    expect(() => groupDbfFiles([{ name: 'ANIMAL2.DBT' }])).toThrow(
      /Add the .dbf table/,
    )
    expect(() => groupDbfFiles([{ name: 'notes.txt' }])).toThrow(
      /No dBase table/,
    )
  })
})
