import { describe, it, expect } from 'vitest'
import {
  BAK_HEADER_BYTES,
  isBakFile,
  MssqlReadError,
  readMssqlBackup,
  readMssqlBackupBlob,
} from '../src/mssql/index.js'
import {
  PAGE_SIZE,
  readPage,
  readRecord,
  slotOffsets,
} from '../src/mssql/pages.js'
import { decodeValue, typeInfo, TYPE } from '../src/mssql/values.js'

/**
 * A SQL Server backup, built byte by byte.
 *
 * No real backup is committed. What the reader depends on is small: a TAPE
 * block, the file header page, and data pages for the five base tables plus
 * the user tables — so that is all this writes.
 */

const TI = {
  int: TYPE.int,
  tinyint: TYPE.tinyint,
  smallint: TYPE.smallint,
  bit: TYPE.bit,
  datetime: TYPE.datetime,
  text: TYPE.text | (16 << 8),
  char2: TYPE.char | (2 << 8),
  sysname: TYPE.nvarchar | (256 << 8),
  varchar50: TYPE.varchar | (50 << 8),
  varchar100: TYPE.varchar | (100 << 8),
  decimal92: TYPE.decimal | (9 << 8) | (2 << 16),
  ntext: TYPE.ntext | (16 << 8),
  image: TYPE.image | (16 << 8),
  nvarcharMax: TYPE.nvarchar | (0xffff << 8),
}

function bytes(size: number, write: (v: DataView) => void): Uint8Array {
  const out = new Uint8Array(size)
  write(new DataView(out.buffer))
  return out
}

interface RecordSpec {
  fixed: Uint8Array
  columns: number
  variable?: Uint8Array[]
  /** Which variable columns hold a pointer rather than the value. */
  complex?: boolean[]
  kind?: number
}

/** One record: status bits, fixed part, null bitmap, variable part. */
function record({
  fixed,
  columns,
  variable = [],
  complex = [],
  kind = 0,
}: RecordSpec): Uint8Array {
  const bitmap = new Uint8Array(Math.ceil(columns / 8))
  const head = 4 + fixed.length
  const varHead = variable.length ? 2 + variable.length * 2 : 0
  let end = head + 2 + bitmap.length + varHead
  const ends = variable.map((v) => (end += v.length))

  const out = new Uint8Array(end)
  const view = new DataView(out.buffer)
  out[0] = (kind << 1) | 0x10 | (variable.length ? 0x20 : 0)
  view.setUint16(2, head, true)
  out.set(fixed, 4)
  view.setUint16(head, columns, true)
  out.set(bitmap, head + 2)

  let at = head + 2 + bitmap.length
  if (variable.length) {
    view.setUint16(at, variable.length, true)
    ends.forEach((e, i) =>
      view.setUint16(at + 2 + i * 2, e | (complex[i] ? 0x8000 : 0), true),
    )
    at += varHead
    for (const v of variable) {
      out.set(v, at)
      at += v.length
    }
  }
  return out
}

/** A data page stamped with an allocation unit, holding these records. */
function dataPage(
  stamp: number,
  pageId: number,
  records: Uint8Array[],
  type = 1,
) {
  const page = new Uint8Array(PAGE_SIZE)
  const view = new DataView(page.buffer)
  page[0] = 1
  page[1] = type
  view.setUint16(22, records.length, true)
  view.setUint32(24, stamp, true)
  view.setUint32(32, pageId, true)
  view.setUint16(36, 1, true)

  let at = 96
  records.forEach((r, slot) => {
    page.set(r, at)
    view.setUint16(PAGE_SIZE - 2 - slot * 2, at, true)
    at += r.length
  })
  view.setUint16(30, at, true)
  return page
}

/** A PFS page for the first interval, marking the listed pages in use. */
function pfsPage(allocated: number[]) {
  const page = new Uint8Array(PAGE_SIZE)
  const view = new DataView(page.buffer)
  page[0] = 1
  page[1] = 11
  view.setUint32(32, 1, true)
  view.setUint16(36, 1, true)
  for (const pageId of allocated) page[100 + pageId] = 0x40
  return page
}

const utf16 = (s: string) => {
  const out = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) {
    out[i * 2] = s.charCodeAt(i) & 0xff
    out[i * 2 + 1] = s.charCodeAt(i) >> 8
  }
  return out
}
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const int32 = (n: number) => bytes(4, (v) => v.setInt32(0, n, true))

const rowsetOf = (objectId: number, indexId: number, partition = 0) =>
  objectId * 100 + indexId * 10 + partition

function allocUnit(stamp: number, owner: number) {
  return record({
    columns: 12,
    fixed: bytes(69, (v) => {
      v.setBigUint64(0, BigInt(stamp) << 16n, true)
      v.setUint8(8, 1)
      v.setBigUint64(9, BigInt(owner), true)
    }),
  })
}

function rowset(
  id: number,
  objectId: number,
  indexId: number,
  rows: number,
  compression = 0,
) {
  return record({
    columns: 18,
    fixed: bytes(53, (v) => {
      v.setBigUint64(0, BigInt(id), true)
      v.setInt32(9, objectId, true)
      v.setInt32(13, indexId, true)
      v.setBigInt64(27, BigInt(rows), true)
      v.setUint8(35, compression)
    }),
  })
}

interface ColumnSpec {
  ti: number
  offset: number
  name?: string
  bitPosition?: number
  dropped?: boolean
  /** The column's position in the physical row, when it differs from its id. */
  hbcolid?: number
}

function rscols(owner: number, columns: ColumnSpec[]) {
  return columns.map((c, i) =>
    record({
      columns: 14,
      fixed: bytes(54, (v) => {
        v.setBigUint64(0, BigInt(owner), true)
        v.setInt32(8, c.dropped ? 0x4000001 : i + 1, true)
        v.setInt32(12, c.hbcolid ?? i + 1, true)
        v.setInt32(24, c.ti, true)
        v.setInt32(36, c.dropped ? 2 : 0, true)
        v.setInt32(40, c.offset & 0xffff, true)
        v.setInt32(44, i + 1, true)
        v.setInt16(48, c.bitPosition ?? 0, true)
      }),
    }),
  )
}

const SCHOBJS: ColumnSpec[] = [
  { ti: TI.int, offset: 4 },
  { ti: TI.sysname, offset: -1 },
  { ti: TI.int, offset: 8 },
  { ti: TI.tinyint, offset: 12 },
  { ti: TI.int, offset: 13 },
  { ti: TI.char2, offset: 17 },
]

const COLPARS: ColumnSpec[] = [
  { ti: TI.int, offset: 4 },
  { ti: TI.smallint, offset: 8 },
  { ti: TI.int, offset: 10 },
  { ti: TI.sysname, offset: -1 },
]

function object(id: number, name: string, type: string) {
  return record({
    columns: 6,
    fixed: bytes(15, (v) => {
      v.setInt32(0, id, true)
      v.setUint8(13, type.charCodeAt(0))
      v.setUint8(14, type.charCodeAt(1))
    }),
    variable: [utf16(name)],
  })
}

function columnName(objectId: number, colId: number, name: string) {
  return record({
    columns: 4,
    fixed: bytes(10, (v) => {
      v.setInt32(0, objectId, true)
      v.setInt32(6, colId, true)
    }),
    variable: [utf16(name)],
  })
}

/** 2025-01-28 10:45:00, as a datetime: 1/300 s ticks, then days since 1900. */
const PUBLISHED = bytes(8, (v) => {
  v.setUint32(0, (10 * 3600 + 45 * 60) * 300, true)
  v.setInt32(4, 45683, true)
})

const BOOKS = 1000
const BOOK_COLUMNS: ColumnSpec[] = [
  { ti: TI.int, offset: 4, name: 'id' },
  { ti: TI.varchar50, offset: -1, name: 'title' },
  { ti: TI.datetime, offset: 8, name: 'published' },
  { ti: TI.decimal92, offset: 16, name: 'price' },
  { ti: TI.bit, offset: 21, bitPosition: 0, name: 'in_stock' },
  { ti: TI.bit, offset: 21, bitPosition: 1, name: 'signed' },
  { ti: TI.text, offset: -2, name: 'notes' },
  { ti: TI.int, offset: 4, dropped: true },
]

function bookSpec(
  id: number,
  title: string,
  price: number,
  flags: number,
): RecordSpec {
  return {
    columns: 8,
    fixed: new Uint8Array([
      ...int32(id),
      ...PUBLISHED,
      1,
      ...bytes(4, (v) => v.setUint32(0, price, true)),
      flags,
    ]),
    variable: [latin1(title), new Uint8Array(16)],
  }
}
const book = (id: number, title: string, price: number, flags: number) =>
  record(bookSpec(id, title, price, flags))

/**
 * A second table that went through `ALTER TABLE`: a variable column dropped
 * ahead of a live one, and a uniquifier the engine added. Its physical order
 * is not its column order either.
 */
const AUTHORS = 1100
const AUTHOR_COLUMNS: ColumnSpec[] = [
  { ti: TI.int, offset: 4, name: 'id', hbcolid: 3 },
  { ti: TI.varchar50, offset: -1, dropped: true },
  { ti: TI.varchar50, offset: -2, name: 'name', hbcolid: 1 },
  { ti: TI.int, offset: -3 },
]
const author = (id: number, name: string) =>
  record({
    columns: 4,
    fixed: int32(id),
    variable: [latin1('gone'), latin1(name), int32(0)],
  })

interface Table {
  objectId: number
  name: string
  stamp: number
  indexId: number
  columns: ColumnSpec[]
  pages: Uint8Array[][]
  compression?: number
}

const TABLES: Table[] = [
  {
    objectId: BOOKS,
    name: 'Books',
    stamp: 50,
    indexId: 0,
    columns: BOOK_COLUMNS,
    pages: [[book(1, 'Dune', 12345, 0b01), book(2, 'Açaí', 50, 0b10)]],
  },
  {
    objectId: AUTHORS,
    name: 'Authors',
    stamp: 60,
    indexId: 1,
    columns: AUTHOR_COLUMNS,
    pages: [[author(1, 'Ada')]],
  },
]

function catalogPages(tables: Table[]): Uint8Array[] {
  const units = [allocUnit(34, rowsetOf(34, 1)), allocUnit(41, rowsetOf(41, 1))]
  const rowsets = [
    rowset(rowsetOf(34, 1), 34, 1, 0),
    rowset(rowsetOf(41, 1), 41, 1, 0),
  ]
  const cols = [
    ...rscols(rowsetOf(34, 1), SCHOBJS),
    ...rscols(rowsetOf(41, 1), COLPARS),
  ]
  const objects = []
  const names = []

  for (const t of tables) {
    t.pages.forEach((_, partition) => {
      const id = rowsetOf(t.objectId, t.indexId, partition)
      units.push(allocUnit(t.stamp + partition, id))
      rowsets.push(
        rowset(
          id,
          t.objectId,
          t.indexId,
          t.pages[partition]!.length,
          t.compression,
        ),
      )
      cols.push(...rscols(id, t.columns))
    })
    objects.push(object(t.objectId, t.name, 'U '))
    t.columns.forEach((c, i) => {
      if (c.name) names.push(columnName(t.objectId, i + 1, c.name))
    })
  }
  objects.push(object(2000, 'pk_books', 'PK'))

  return [
    dataPage(7, 2, units),
    dataPage(5, 3, rowsets),
    dataPage(3, 4, cols),
    dataPage(34, 5, objects),
    dataPage(41, 6, names),
  ]
}

function backup(
  tables = TABLES,
  extra: (pages: Uint8Array[]) => void = () => {},
): Uint8Array {
  const tape = bytes(1024, (v) => {
    v.setUint32(0, 0x45504154, true)
    v.setUint16(84, 1024, true)
  })

  const fileHeader = new Uint8Array(PAGE_SIZE)
  fileHeader[0] = 1
  fileHeader[1] = 15
  new DataView(fileHeader.buffer).setUint16(36, 1, true)

  let next = 10
  const pages = [fileHeader, ...catalogPages(tables)]
  for (const t of tables) {
    t.pages.forEach((records, partition) => {
      pages.push(dataPage(t.stamp + partition, next++, records))
    })
  }
  extra(pages)

  const out = new Uint8Array(tape.length + pages.length * PAGE_SIZE)
  out.set(tape)
  pages.forEach((p, i) => out.set(p, tape.length + i * PAGE_SIZE))
  return out
}

/** An MTF `SSET` block header, checksum and all: another backup set begins. */
function setStart(): Uint8Array {
  const block = bytes(PAGE_SIZE, (v) => {
    v.setUint32(0, 0x54455353, true)
    let sum = 0
    for (let word = 0; word < 25; word++) sum ^= v.getUint16(word * 2, true)
    v.setUint16(50, sum, true)
  })
  return block
}

/**
 * Large values, kept off the row on text pages.
 *
 * Every piece is a blob fragment — record kind 4, all of it in the fixed
 * part — that opens with an 8-byte blob id and a 2-byte structure type.
 */
const LOB = { smallRoot: 0, internal: 2, data: 3, largeRoot: 5 }
const TEXT_MIX = 3
const TEXT_TREE = 4

function fragment(type: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(14 + body.length)
  const view = new DataView(out.buffer)
  out[0] = 4 << 1
  view.setUint16(2, out.length, true)
  view.setBigUint64(4, 0x1234n << 16n, true)
  view.setUint16(12, type, true)
  out.set(body, 14)
  return out
}

interface Link {
  end: number
  page: number
  slot: number
}

/** Page, file and slot: where a pointer or a link leads. */
const rowId = (page: number, slot: number) =>
  bytes(8, (v) => {
    v.setUint32(0, page, true)
    v.setUint16(4, 1, true)
    v.setUint16(6, slot, true)
  })

const link = ({ end, page, slot }: Link) =>
  new Uint8Array([...int32(end), ...rowId(page, slot)])

const lobData = (data: Uint8Array) => fragment(LOB.data, data)

const smallRoot = (data: Uint8Array) =>
  fragment(
    LOB.smallRoot,
    new Uint8Array([
      ...bytes(6, (v) => v.setUint16(0, data.length, true)),
      ...data,
      ...new Uint8Array(64 - data.length),
    ]),
  )

/** Max links, cur links and level, then the links. */
function linkHeader(links: number, level: number, pad: number) {
  return bytes(6 + pad, (v) => {
    v.setUint16(0, 5, true)
    v.setUint16(2, links, true)
    v.setUint16(4, level, true)
  })
}

const largeRoot = (links: Link[], level = 0) =>
  fragment(
    LOB.largeRoot,
    new Uint8Array([
      ...linkHeader(links.length, level, 4),
      ...links.flatMap((l) => [...link(l)]),
    ]),
  )

const internal = (links: Link[], level = 0) =>
  fragment(
    LOB.internal,
    new Uint8Array([
      ...linkHeader(links.length, level, 0),
      ...links.flatMap((l) => [
        ...bytes(8, (v) => v.setBigUint64(0, BigInt(l.end), true)),
        ...rowId(l.page, l.slot),
      ]),
    ]),
  )

/** The 16 bytes a text, ntext or image column keeps in the row. */
const textPointer = (page: number, slot: number) =>
  new Uint8Array([...new Uint8Array(8), ...rowId(page, slot)])

/** The complex column a max or row-overflow value leaves in the row. */
const inlineRoot = (kind: number, links: Link[]) =>
  new Uint8Array([
    kind,
    ...new Uint8Array(11),
    ...links.flatMap((l) => [...link(l)]),
  ])

const ROW_OVERFLOW = 2
const INLINE_ROOT = 4

const BODY = latin1('Açaí must flow')
const IMAGE = new Uint8Array([0, 1, 2, 0xff, 0xfe, 0xfd])

/** Page 40 holds small pieces and data; page 41, the rest of the trees. */
const TEXT_PAGE = [
  lobData(BODY.subarray(0, 10)),
  largeRoot([
    { end: 10, page: 40, slot: 0 },
    { end: 14, page: 41, slot: 0 },
  ]),
  smallRoot(utf16('Olá, mundo')),
  lobData(IMAGE.subarray(0, 4)),
  internal([
    { end: 4, page: 40, slot: 3 },
    { end: 6, page: 41, slot: 1 },
  ]),
  largeRoot([{ end: 6, page: 40, slot: 4 }], 1),
  lobData(utf16('Hello, ')),
  lobData(utf16('world')),
  lobData(latin1('overflowed')),
]
const TREE_PAGE = [
  lobData(BODY.subarray(10)),
  lobData(IMAGE.subarray(4)),
  largeRoot([{ end: 6, page: 41, slot: 2 }]),
]

const textPages = (mix = TEXT_PAGE, tree = TREE_PAGE) => [
  dataPage(80, 40, mix, TEXT_MIX),
  dataPage(81, 41, tree, TEXT_TREE),
]

const DOCS = 1200
const DOC_COLUMNS: ColumnSpec[] = [
  { ti: TI.int, offset: 4, name: 'id' },
  { ti: TI.text, offset: -1, name: 'body' },
  { ti: TI.ntext, offset: -2, name: 'note' },
  { ti: TI.image, offset: -3, name: 'scan' },
  { ti: TI.nvarcharMax, offset: -4, name: 'summary' },
  { ti: TI.varchar100, offset: -5, name: 'tail' },
]

const doc = (id: number, variable: Uint8Array[]) =>
  record({
    columns: 6,
    fixed: int32(id),
    variable,
    complex: [false, false, false, true, true],
  })

const GOOD_DOC = [
  textPointer(40, 1),
  textPointer(40, 2),
  textPointer(40, 5),
  inlineRoot(INLINE_ROOT, [
    { end: 14, page: 40, slot: 6 },
    { end: 24, page: 40, slot: 7 },
  ]),
  inlineRoot(ROW_OVERFLOW, [{ end: 10, page: 40, slot: 8 }]),
]

/** Every pointer broken a different way. */
const BROKEN_DOC = [
  // A page the backup does not hold.
  textPointer(99, 0),
  // A data page, not a text page.
  textPointer(10, 0),
  // A root that links to itself.
  textPointer(41, 2),
  // A link promising more than its fragment holds.
  inlineRoot(INLINE_ROOT, [{ end: 100, page: 40, slot: 6 }]),
  // A complex column that is no pointer at all.
  inlineRoot(5, [{ end: 10, page: 40, slot: 8 }]),
]

const docsTable = (rows: Uint8Array[]): Table => ({
  objectId: DOCS,
  name: 'Docs',
  stamp: 70,
  indexId: 0,
  columns: DOC_COLUMNS,
  pages: [rows],
})

function lobBackup(
  rows = [doc(1, GOOD_DOC), doc(2, BROKEN_DOC)],
  pages = textPages(),
) {
  return backup([...TABLES, docsTable(rows)], (all) => all.push(...pages))
}

const GOOD_ROW = [
  1,
  'Açaí must flow',
  'Olá, mundo',
  IMAGE,
  'Hello, world',
  'overflowed',
]

const tableNamed = (db: ReturnType<typeof readMssqlBackup>, name: string) =>
  db.tables.find((t) => t.name === name)

describe('isBakFile', () => {
  it('recognises the tape header a backup opens with', () => {
    expect(isBakFile(backup().subarray(0, BAK_HEADER_BYTES))).toBe(true)
  })

  it('refuses a head too short to decide on', () => {
    expect(isBakFile(backup().subarray(0, 8))).toBe(false)
  })

  it('refuses TAPE without a sensible block size', () => {
    const head = backup().slice(0, BAK_HEADER_BYTES)
    new DataView(head.buffer).setUint16(84, 1000, true)
    expect(isBakFile(head)).toBe(false)
  })

  it('does not take other databases for a backup', () => {
    expect(isBakFile(latin1('SQLite format 3\0'.padEnd(128)))).toBe(false)
    expect(isBakFile(new Uint8Array(128))).toBe(false)
  })
})

describe('readMssqlBackup', () => {
  const db = readMssqlBackup(backup())
  const books = tableNamed(db, 'Books')
  const authors = tableNamed(db, 'Authors')

  it('finds the user tables and nothing else', () => {
    expect(db.tables.map((t) => t.name)).toEqual(['Authors', 'Books'])
    expect(db.unreadable).toEqual([])
  })

  it('names columns from the catalog and leaves the dropped one out', () => {
    expect(books?.columns.map((c) => c.name)).toEqual([
      'id',
      'title',
      'published',
      'price',
      'in_stock',
      'signed',
      'notes',
    ])
    expect(books?.columns.map((c) => c.declaredType)).toEqual([
      'INT',
      'VARCHAR(50)',
      'DATETIME',
      'DECIMAL(9,2)',
      'BIT',
      'BIT',
      'TEXT',
    ])
  })

  it('decodes every row', () => {
    expect(books?.rowCount).toBe(2)
    expect(books?.rows).toEqual([
      [1, 'Dune', '2025-01-28 10:45:00.000', '123.45', 1, 0, null],
      [2, 'Açaí', '2025-01-28 10:45:00.000', '0.50', 0, 1, null],
    ])
  })

  it('finds a variable column by its own slot, past a dropped one', () => {
    expect(authors?.rows).toEqual([[1, 'Ada']])
  })

  it('orders and names columns by column id, not by physical position', () => {
    expect(authors?.columns.map((c) => c.name)).toEqual(['id', 'name'])
  })

  it('leaves out a column the engine added, such as a uniquifier', () => {
    expect(authors?.columns).toHaveLength(2)
  })

  it('writes a CREATE TABLE the export can use', () => {
    expect(books?.createStatement).toContain('CREATE TABLE "Books"')
    expect(books?.createStatement).toContain('"price" DECIMAL(9,2)')
  })

  it('stops at the row limit but still reports the full count', () => {
    const limited = tableNamed(
      readMssqlBackup(backup(), { rowLimit: 1 }),
      'Books',
    )
    expect(limited?.rows).toHaveLength(1)
    expect(limited?.rowCount).toBe(2)
  })

  it('reads every partition of a partitioned table', () => {
    const [books] = TABLES
    const partitioned = backup([
      { ...books!, pages: [[book(1, 'Dune', 1, 0)], [book(2, 'Emma', 1, 0)]] },
    ])
    const table = tableNamed(readMssqlBackup(partitioned), 'Books')
    expect(table?.rows.map((r) => r[1])).toEqual(['Dune', 'Emma'])
    expect(table?.rowCount).toBe(2)
  })

  it('refuses a compressed table by name rather than guessing at it', () => {
    const [books] = TABLES
    const db = readMssqlBackup(backup([{ ...books!, compression: 2 }]))
    expect(db.tables).toEqual([])
    expect(db.unreadable).toEqual([
      {
        name: 'Books',
        reason: 'compressed',
        detail: 'row or page compression',
      },
    ])
  })

  it('reads a heap row that moved, and not the stub it left', () => {
    const moved = backup(TABLES, (pages) => {
      const stub = record({ kind: 2, columns: 0, fixed: new Uint8Array(9) })
      const forwarded = record({ ...bookSpec(3, 'Emma', 1, 0), kind: 1 })
      pages.push(dataPage(50, 20, [stub]), dataPage(50, 21, [forwarded]))
    })
    const titles = tableNamed(readMssqlBackup(moved), 'Books')?.rows.map(
      (r) => r[1],
    )
    expect(titles).toEqual(['Dune', 'Açaí', 'Emma'])
  })

  it('keeps the later copy of a page the backup wrote twice', () => {
    const rewritten = backup(TABLES, (pages) => {
      pages.push(dataPage(50, 10, [book(1, 'Dune, revised', 1, 0)]))
    })
    const titles = tableNamed(readMssqlBackup(rewritten), 'Books')?.rows.map(
      (r) => r[1],
    )
    expect(titles).toEqual(['Dune, revised'])
  })

  it('leaves out a data page its PFS page says is free', () => {
    const freed = backup(TABLES, (pages) => {
      // Everything in use except page 10, which held the books.
      pages.push(pfsPage([2, 3, 4, 5, 6, 11]))
    })
    expect(tableNamed(readMssqlBackup(freed), 'Books')?.rows).toEqual([])
  })

  it('reads only the first backup set in the file', () => {
    const appended = backup(TABLES, (pages) => {
      pages.push(setStart(), dataPage(50, 30, [book(9, 'Later', 1, 0)]))
    })
    const titles = tableNamed(readMssqlBackup(appended), 'Books')?.rows.map(
      (r) => r[1],
    )
    expect(titles).toEqual(['Dune', 'Açaí'])
  })

  it('refuses a backup with more table data than it may hold', () => {
    expect(() =>
      readMssqlBackup(backup(), { maxDataBytes: 2 * PAGE_SIZE }),
    ).toThrow(MssqlReadError)
  })

  it('says why when there are no pages to read', () => {
    const tapeOnly = backup().subarray(0, 1024)
    expect(() => readMssqlBackup(tapeOnly)).toThrow(/Compressed, encrypted/)
  })
})

describe('readMssqlBackupBlob', () => {
  it('reads the same from a Blob as from bytes', async () => {
    const whole = backup()
    expect(await readMssqlBackupBlob(new Blob([whole]))).toEqual(
      readMssqlBackup(whole),
    )
  })

  it('carries on across chunks', async () => {
    // 4096 empty pages push the tables past the first 32 MB read.
    const spread = backup(TABLES, (pages) => {
      const books = pages.splice(pages.length - 2)
      for (let i = 0; i < 4096; i++) pages.push(new Uint8Array(PAGE_SIZE))
      pages.push(...books)
    })
    const db = await readMssqlBackupBlob(new Blob([spread]))
    expect(tableNamed(db, 'Books')?.rows).toHaveLength(2)
    expect(tableNamed(db, 'Authors')?.rows).toHaveLength(1)
  })

  it('refuses a file with no database inside', () => {
    const tapeOnly = backup().subarray(0, 1024)
    return expect(readMssqlBackupBlob(new Blob([tapeOnly]))).rejects.toThrow(
      MssqlReadError,
    )
  })
})

describe('values kept off the row', () => {
  const docs = (bak: Uint8Array) => tableNamed(readMssqlBackup(bak), 'Docs')

  it('follows text pointers and inline roots to the value', () => {
    const table = docs(lobBackup())
    expect(table?.rows[0]).toEqual(GOOD_ROW)
    expect(table?.columns.map((c) => c.declaredType)).toEqual([
      'INT',
      'TEXT',
      'NTEXT',
      'IMAGE',
      'NVARCHAR(max)',
      'VARCHAR(100)',
    ])
  })

  it('gives NULL for a pointer that leads nowhere sensible', () => {
    expect(docs(lobBackup())?.rows[1]).toEqual([
      2,
      null,
      null,
      null,
      null,
      null,
    ])
  })

  it('reads the same from a Blob as from bytes', async () => {
    const whole = lobBackup()
    expect(await readMssqlBackupBlob(new Blob([whole]))).toEqual(
      readMssqlBackup(whole),
    )
  })

  it('keeps the later copy of a text page the backup wrote twice', () => {
    const [mix, tree] = textPages()
    const later = dataPage(
      81,
      41,
      [lobData(latin1('FLOW')), ...TREE_PAGE.slice(1)],
      TEXT_TREE,
    )
    const table = docs(lobBackup(undefined, [mix!, tree!, later]))
    expect(table?.rows[0]?.[1]).toBe('Açaí must FLOW')
  })

  it('leaves out a text page its PFS page says is free', () => {
    const pages = [...textPages(), pfsPage([2, 3, 4, 5, 6, 10, 11, 12, 41])]
    const table = docs(lobBackup([doc(1, GOOD_DOC)], pages))
    expect(table?.rows).toEqual([[1, null, null, null, null, null]])
  })

  /** The body column of one row whose body pointer is `pointer`. */
  const bodyOf = (pointer: Uint8Array, pages: Uint8Array[]) =>
    docs(lobBackup([doc(1, [pointer, ...BROKEN_DOC.slice(1)])], pages))
      ?.rows[0]?.[1]

  it('reads a tree with more than one INTERNAL node', () => {
    const mix = ['ab', 'cd', 'ef', 'gh'].map((s) => lobData(latin1(s)))
    const tree = [
      largeRoot(
        [
          { end: 4, page: 41, slot: 1 },
          { end: 8, page: 41, slot: 2 },
        ],
        1,
      ),
      internal([
        { end: 2, page: 40, slot: 0 },
        { end: 4, page: 40, slot: 1 },
      ]),
      // Offsets counted from the value's start rather than the node's: the
      // data is the same either way.
      internal([
        { end: 6, page: 40, slot: 2 },
        { end: 8, page: 40, slot: 3 },
      ]),
    ]
    expect(bodyOf(textPointer(41, 0), textPages(mix, tree))).toBe('abcdefgh')
  })

  it('gives up on a tree deeper than any real one', () => {
    const chain = (depth: number) => [
      ...Array.from({ length: depth }, (_, i) =>
        internal([{ end: 4, page: 40, slot: i + 1 }]),
      ),
      lobData(latin1('deep')),
    ]
    const read = (depth: number) =>
      bodyOf(textPointer(40, 0), textPages(chain(depth)))
    expect(read(16)).toBe('deep')
    expect(read(17)).toBeNull()
  })

  it('will not build a value out of one fragment named by many slots', () => {
    const mix = dataPage(80, 40, [lobData(new Uint8Array(4000))], TEXT_MIX)
    const view = new DataView(mix.buffer)
    view.setUint16(22, 1900, true)
    for (let slot = 0; slot < 1900; slot++)
      view.setUint16(PAGE_SIZE - 2 - slot * 2, 96, true)
    const links = Array.from({ length: 490 }, (_, slot) => ({
      end: (slot + 1) * 4000,
      page: 40,
      slot,
    }))
    const tree = dataPage(81, 41, [internal(links)], TEXT_TREE)
    expect(bodyOf(textPointer(41, 0), [mix, tree])).toBeNull()
  })

  it('stops once the rows ask for more than the text pages hold', () => {
    const pages = textPages([lobData(new Uint8Array(4000).fill(0x61))], [])
    const rows = Array.from({ length: 6 }, (_, i) =>
      doc(i + 1, [textPointer(40, 0), ...BROKEN_DOC.slice(1)]),
    )
    const bodies = docs(lobBackup(rows, pages))?.rows.map((r) => r[1])
    // Two text pages hold 16 KB, room for four copies of 4000 bytes.
    expect(bodies?.filter((b) => b !== null)).toHaveLength(4)
    expect(bodies?.slice(4)).toEqual([null, null])
  })

  it('never throws on damaged roots or pointers, only loses the value', () => {
    const recordAt = (slot: number) =>
      TEXT_PAGE.slice(0, slot).reduce((at, r) => at + r.length, 96)

    /** Flip one byte of the text page, or of a row's pointer, at a time. */
    const targets = [
      { column: 1, slot: 1, bytes: TEXT_PAGE[1]!.length },
      // Past its header, a SMALL_ROOT is the data itself.
      { column: 2, slot: 2, bytes: 20 },
      { column: 3, slot: 4, bytes: TEXT_PAGE[4]!.length },
      { column: 3, slot: 5, bytes: TEXT_PAGE[5]!.length },
      { column: 1, pointer: 0 },
      { column: 4, pointer: 3 },
      { column: 5, pointer: 4 },
    ]

    for (const target of targets) {
      const seen = new Set<unknown>()
      const flips =
        target.pointer === undefined
          ? target.bytes
          : GOOD_DOC[target.pointer]!.length
      for (let i = 0; i < flips; i++) {
        const [mix, tree] = textPages()
        const pointers = GOOD_DOC.map((p) => p.slice())
        if (target.pointer === undefined)
          mix![recordAt(target.slot) + i] ^= 0xff
        else pointers[target.pointer]![i] ^= 0xff

        const row = docs(lobBackup([doc(1, pointers)], [mix!, tree!]))?.rows[0]
        const value = row?.[target.column]
        expect([GOOD_ROW[target.column], null]).toContainEqual(value)
        seen.add(value === null ? 'lost' : 'kept')
      }
      // Both outcomes happen: the check is not passing on one alone.
      expect(seen).toEqual(new Set(['kept', 'lost']))
    }
  })
})

describe('readPage', () => {
  it('puts back the bits torn-page detection displaced', () => {
    const page = dataPage(50, 1, [])
    const view = new DataView(page.buffer)
    view.setUint16(4, 0x0100, true)
    // The last sector's original low bits were 00; the marker wrote 01.
    view.setUint32(60, 0x15555555, true)
    page[PAGE_SIZE - 1] = 0x01

    const fixed = readPage(page, 0)
    expect(fixed[PAGE_SIZE - 1]).toBe(0x00)
    expect(page[PAGE_SIZE - 1]).toBe(0x01)
  })

  it('leaves a page without torn-page detection alone', () => {
    const page = dataPage(50, 1, [])
    page[PAGE_SIZE - 1] = 0x01
    const read = readPage(page, 0)
    expect(read.buffer).toBe(page.buffer)
    expect(read[PAGE_SIZE - 1]).toBe(0x01)
  })
})

describe('slotOffsets and readRecord', () => {
  it('survives a slot count no page could hold', () => {
    const page = new Uint8Array(PAGE_SIZE)
    const view = new DataView(page.buffer)
    expect(() => slotOffsets(view, 0xffff)).not.toThrow()
  })

  it('skips a slot pointing at the last bytes of the page', () => {
    const page = new Uint8Array(PAGE_SIZE)
    const view = new DataView(page.buffer)
    view.setUint16(PAGE_SIZE - 2, PAGE_SIZE - 2, true)
    expect(slotOffsets(view, 1)).toEqual([])
    expect(readRecord(page, view, PAGE_SIZE - 2)).toBeNull()
  })

  it('refuses a record whose fixed part runs off the page', () => {
    const page = new Uint8Array(PAGE_SIZE)
    const view = new DataView(page.buffer)
    view.setUint16(PAGE_SIZE - 100 + 2, 500, true)
    expect(readRecord(page, view, PAGE_SIZE - 100)).toBeNull()
  })

  it('keeps the pointer of a value kept off the row, marked complex', () => {
    const bytes = record({
      columns: 2,
      fixed: new Uint8Array(0),
      variable: [latin1('here'), new Uint8Array(24)],
    })
    const view = new DataView(bytes.buffer)
    // Mark the second slot complex, as a row-overflow pointer is.
    const second = 4 + 2 + 1 + 2 + 2
    view.setUint16(second, view.getUint16(second, true) | 0x8000, true)

    const page = new Uint8Array(PAGE_SIZE)
    page.set(bytes, 96)
    const parsed = readRecord(page, new DataView(page.buffer), 96)
    expect(parsed?.variable[0]).toEqual(latin1('here'))
    expect(parsed?.variable[1]).toEqual(new Uint8Array(24))
    expect(parsed?.complex).toEqual([false, true])
  })
})

describe('decodeValue', () => {
  const decode = (ti: number, hex: string, bit = 0) =>
    decodeValue(
      Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16)),
      typeInfo(ti),
      bit,
      'windows-1252',
    )

  /** Little-endian bytes of `value`, `width` wide, as hex. */
  const le = (value: bigint, width: number) => {
    let out = ''
    for (let i = 0; i < width; i++)
      out += ((value >> BigInt(8 * i)) & 0xffn).toString(16).padStart(2, '0')
    return out
  }
  /** 2025-01-28 as days since 0001-01-01. */
  const DAY = le(739278n, 3)
  const at1045 = (scale: number) =>
    (10n * 3600n + 45n * 60n) * 10n ** BigInt(scale)

  it('keeps decimals and money exact', () => {
    expect(
      decode(TYPE.decimal | (18 << 8) | (5 << 16), '01e067350000000000'),
    ).toBe('35.00000')
    expect(decode(TYPE.decimal | (9 << 8) | (2 << 16), '0005000000')).toBe(
      '-0.05',
    )
    expect(decode(TYPE.money, '1027000000000000')).toBe('1.0000')
    expect(decode(TYPE.money, 'f0d8ffffffffffff')).toBe('-1.0000')
  })

  it('reads the date types from their own epochs', () => {
    expect(decode(TYPE.date, DAY)).toBe('2025-01-28')
    expect(decode(TYPE.smalldatetime, '73b28502')).toBe('2025-01-28 10:45:00')
  })

  it('keeps fractional seconds to the declared scale', () => {
    const time7 = TYPE.time | (7 << 16)
    expect(decode(time7, le(at1045(7) + 1234567n, 5))).toBe('10:45:00.1234567')
    const dt3 = TYPE.datetime2 | (3 << 16)
    expect(decode(dt3, le(at1045(3) + 5n, 4) + DAY)).toBe(
      '2025-01-28 10:45:00.005',
    )
  })

  it('shows a datetimeoffset in the offset it was written in', () => {
    const dto = TYPE.datetimeoffset | (0 << 16)
    // 01:30 UTC on the 28th is 22:30 the evening before at -03:00.
    const utc = le(90n * 60n, 3) + DAY + le(BigInt(-180 & 0xffff), 2)
    expect(decode(dto, utc)).toBe('2025-01-27 22:30:00-03:00')
  })

  it('reads a uniqueidentifier in its written order', () => {
    expect(
      decode(TYPE.uniqueidentifier, '33221100554477668899aabbccddeeff'),
    ).toBe('00112233-4455-6677-8899-aabbccddeeff')
  })

  it('picks each bit out of a shared byte', () => {
    expect(decode(TYPE.bit, '02', 0)).toBe(0)
    expect(decode(TYPE.bit, '02', 1)).toBe(1)
  })

  it('reads varchar in the database code page and nvarchar as UTF-16', () => {
    expect(decode(TYPE.varchar, '53c34f')).toBe('SÃO')
    expect(decode(TYPE.nvarchar, '53000301')).toBe('Să')
  })

  it('reads text, ntext and image as their in-row cousins', () => {
    expect(decode(TYPE.text, '53c34f')).toBe('SÃO')
    expect(decode(TYPE.ntext, '53000301')).toBe('Să')
    expect(decode(TYPE.image, '0102')).toEqual(new Uint8Array([1, 2]))
  })

  it('hands back the bytes of a type only its own code can read', () => {
    expect(decode(240, '0102')).toEqual(new Uint8Array([1, 2]))
  })
})
