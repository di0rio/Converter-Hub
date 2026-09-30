/**
 * The page and record layer of a SQL Server database file.
 *
 * A `.bak` is not a database: it is a Microsoft Tape Format container whose
 * data stream holds the database file almost verbatim — the same 8 KB pages,
 * with unallocated extents left out. So the work splits in two. Finding where
 * the pages begin is a header search, done once; reading them is everything
 * below.
 *
 * A page is a 96-byte header, records growing from the front, and a slot array
 * growing backwards from the end. The slot array is in key order, not in the
 * order the records sit on the page, which is why nothing here assumes a
 * record follows the one before it.
 */

import { SqliteReadError } from '../sqlite/index.js'

export class MssqlReadError extends SqliteReadError {
  readonly detail: string

  constructor(message: string, detail = '') {
    super(message)
    this.detail = detail
  }
}

const DAMAGED = 'This SQL Server backup is damaged or incomplete.'

export function damaged(detail: string): MssqlReadError {
  return new MssqlReadError(DAMAGED, detail)
}

export const PAGE_SIZE = 8192
const HEADER_SIZE = 96
const SECTOR_SIZE = 512
const SECTORS = PAGE_SIZE / SECTOR_SIZE

/**
 * Page types this reader cares about. The rest are allocation bookkeeping.
 * Large values live on the two text page types: small ones share a mixed
 * page, and the tree above a large one sits on text tree pages.
 */
export const PAGE = {
  data: 1,
  textMix: 3,
  textTree: 4,
  pfs: 11,
  fileHeader: 15,
}

/** `m_flagBits`: the page ends each sector with torn-page bits, not data. */
const TORN_PAGE = 0x0100

/**
 * Recognising the container.
 *
 * Every MTF volume opens with a `TAPE` descriptor block. Four characters are a
 * weak test on their own, so the format's own logical block size — a power of
 * two, at a fixed offset — has to agree as well.
 */
export const BAK_HEADER_BYTES = 88

const TAPE = 0x45504154 // 'TAPE', little-endian
const SSET = 0x54455353 // 'SSET', little-endian

export function isBakFile(head: Uint8Array): boolean {
  if (head.length < BAK_HEADER_BYTES) return false
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength)
  if (v.getUint32(0, true) !== TAPE) return false

  const blockSize = v.getUint16(84, true)
  return blockSize >= 512 && (blockSize & (blockSize - 1)) === 0
}

/**
 * Is there an MTF block here that opens another backup set?
 *
 * `BACKUP` appends to an existing file unless told otherwise, so one `.bak`
 * can hold several backups of the same database one after another. Each opens
 * with an `SSET` block, whose header is closed by a checksum — the XOR of its
 * first 25 words — which is what keeps four letters inside a row from passing
 * for one.
 */
export function isSetStart(bytes: Uint8Array, at: number): boolean {
  if (at + 52 > bytes.length) return false
  const v = new DataView(bytes.buffer, bytes.byteOffset + at, 52)
  if (v.getUint32(0, true) !== SSET) return false

  let sum = 0
  for (let word = 0; word < 25; word++) sum ^= v.getUint16(word * 2, true)
  return sum === v.getUint16(50, true)
}

/** How far into the backup the file header page may be. */
export const IMAGE_SEARCH_BYTES = 64 * 1024 * 1024

const NO_PAGES =
  'This SQL Server backup holds no database pages this tool can read. Compressed, encrypted and transaction log backups cannot be read.'

/**
 * Where the database file starts inside the backup.
 *
 * The data stream is preceded by descriptor blocks whose combined length
 * depends on how many files and filegroups the database has, so rather than
 * walking them this looks for what it actually needs: the file header page,
 * which is page 0 of file 1 and is unmistakable. Everything after it is a run
 * of pages. A compressed or encrypted backup has none to find.
 */
export function findImage(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const limit = Math.min(bytes.length - PAGE_SIZE, IMAGE_SEARCH_BYTES)

  for (let at = 0; at <= limit; at += SECTOR_SIZE) {
    if (bytes[at] !== 1 || bytes[at + 1] !== PAGE.fileHeader) continue
    if (v.getUint32(at + 32, true) !== 0) continue
    if (v.getUint16(at + 36, true) !== 1) continue
    return at
  }

  throw new MssqlReadError(NO_PAGES, 'no file header page')
}

/**
 * Where a page says it lives: its file and its number in that file.
 *
 * A backup can hold the same page more than once — the first extents are
 * written again at the end, after the copy — and the later one is current.
 */
export function pageAddress(page: Uint8Array, at = 0): number {
  const v = new DataView(page.buffer, page.byteOffset + at, 38)
  return v.getUint16(36, true) * 2 ** 32 + v.getUint32(32, true)
}

/**
 * The allocation unit a page belongs to, as its header records it: the index
 * half of the unit id above the object half, which is bits 16 to 63 of the id.
 */
export function pageStamp(page: Uint8Array, at = 0): number {
  const v = new DataView(page.buffer, page.byteOffset + at, 28)
  return v.getUint16(6, true) * 2 ** 32 + v.getUint32(24, true)
}

/**
 * Could these 8 KB be a data page?
 *
 * The first two bytes alone are too easy to hit by chance in the log and the
 * container's own blocks, so the header has to be self-consistent as well.
 */
export function isDataPage(bytes: Uint8Array, at: number): boolean {
  return bytes[at + 1] === PAGE.data && isRecordPage(bytes, at)
}

/** The same, for a page holding pieces of large values. */
export function isLobPage(bytes: Uint8Array, at: number): boolean {
  const type = bytes[at + 1]
  return (
    (type === PAGE.textMix || type === PAGE.textTree) && isRecordPage(bytes, at)
  )
}

function isRecordPage(bytes: Uint8Array, at: number): boolean {
  if (bytes[at] !== 1) return false
  const v = new DataView(bytes.buffer, bytes.byteOffset + at, HEADER_SIZE)
  const slots = v.getUint16(22, true)
  const freeData = v.getUint16(30, true)
  return (
    v.getUint16(36, true) >= 1 &&
    slots * 2 <= PAGE_SIZE - HEADER_SIZE &&
    freeData >= HEADER_SIZE &&
    freeData <= PAGE_SIZE
  )
}

export function isPfsPage(bytes: Uint8Array, at: number): boolean {
  return bytes[at] === 1 && bytes[at + 1] === PAGE.pfs
}

/** Each PFS page describes this many pages, one byte apiece. */
const PFS_INTERVAL = 8088
const PFS_BYTES_AT = HEADER_SIZE + 4
const ALLOCATED = 0x40

/** The page number of the PFS page that describes `pageId`. */
export function pfsPageFor(pageId: number): number {
  return pageId < PFS_INTERVAL
    ? 1
    : Math.floor(pageId / PFS_INTERVAL) * PFS_INTERVAL
}

/**
 * Is the page in use?
 *
 * A page freed inside an extent that is still allocated keeps its old header
 * and its old rows, and a backup copies whole extents, so without this check
 * rows deleted long ago would come back.
 */
export function isAllocated(pfs: Uint8Array, pageId: number): boolean {
  const byte = pfs[PFS_BYTES_AT + (pageId % PFS_INTERVAL)]
  return byte !== undefined && (byte & ALLOCATED) !== 0
}

export interface PageHeader {
  type: number
  level: number
  slotCount: number
}

export function readPageHeader(page: DataView): PageHeader {
  return {
    type: page.getUint8(1),
    level: page.getUint8(3),
    slotCount: page.getUint16(22, true),
  }
}

/**
 * A page as its writer left it.
 *
 * With torn-page detection on, every 512-byte sector has the low two bits of
 * its last byte overwritten with a marker, and the bits that were displaced
 * are kept together in `m_tornBits`. Put them back before anything reads the
 * page, or a record offset in the last sector comes out 256 too high. The
 * first sector is left alone: it holds `m_tornBits` itself and is not marked.
 */
export function readPage(bytes: Uint8Array, at: number): Uint8Array {
  const page = bytes.subarray(at, at + PAGE_SIZE)
  if (page.length < PAGE_SIZE) throw damaged('page runs past the end')

  const flags = (page[4] as number) | ((page[5] as number) << 8)
  if ((flags & TORN_PAGE) === 0) return page

  const fixed = page.slice()
  const torn = new DataView(
    fixed.buffer,
    fixed.byteOffset,
    PAGE_SIZE,
  ).getUint32(60, true)
  for (let sector = 1; sector < SECTORS; sector++) {
    const last = sector * SECTOR_SIZE + SECTOR_SIZE - 1
    fixed[last] =
      ((fixed[last] as number) & 0xfc) | ((torn >>> (2 * sector)) & 3)
  }
  return fixed
}

/** Where each record on the page begins, in the slot array's own order. */
export function slotOffsets(page: DataView, count: number): number[] {
  const offsets: number[] = []
  const slots = Math.min(count, (PAGE_SIZE - HEADER_SIZE) / 2)
  for (let slot = 0; slot < slots; slot++) {
    const at = page.getUint16(PAGE_SIZE - 2 - slot * 2, true)
    if (at >= HEADER_SIZE && at + 4 <= PAGE_SIZE) offsets.push(at)
  }
  return offsets
}

/**
 * Where the record in one slot begins, or -1 if the slot is out of range or
 * points nowhere sensible. Pointers to large values name a slot by number.
 */
export function slotAt(page: DataView, count: number, slot: number): number {
  if (slot < 0 || slot >= Math.min(count, (PAGE_SIZE - HEADER_SIZE) / 2))
    return -1
  const at = page.getUint16(PAGE_SIZE - 2 - slot * 2, true)
  return at >= HEADER_SIZE && at + 4 <= PAGE_SIZE ? at : -1
}

/**
 * The high bit of a variable column's end offset: a complex column, which
 * holds not the value but a structure — usually a pointer to where it went.
 */
const COMPLEX = 0x8000

/** `status bits A`, which says what the rest of the record looks like. */
const STATUS = { type: 0x0e, nullBitmap: 0x10, variable: 0x20 }

export interface Record {
  /** Where the record starts on its page. */
  at: number
  /** 0 for a live row. Ghosts, stubs and blob fragments are not rows. */
  kind: number
  /** The fixed-length columns, indexed by their offset less four. */
  fixed: Uint8Array
  /** How many columns the row was written with — older rows have fewer. */
  columnCount: number
  nullBitmap: Uint8Array | null
  /** The variable-length columns' bytes, in the order they are stored. */
  variable: Uint8Array[]
  /**
   * Which of them are complex. For those the bytes are a pointer to a value
   * kept off the row — row-overflow or a large object — not the value.
   */
  complex: boolean[]
}

export function readRecord(
  page: Uint8Array,
  view: DataView,
  at: number,
): Record | null {
  if (at + 4 > PAGE_SIZE) return null
  const status = page[at] as number
  const fixedEnd = view.getUint16(at + 2, true)
  if (fixedEnd < 4 || at + fixedEnd > PAGE_SIZE) return null

  const record: Record = {
    at,
    kind: (status & STATUS.type) >> 1,
    fixed: page.subarray(at + 4, at + fixedEnd),
    columnCount: 0,
    nullBitmap: null,
    variable: [],
    complex: [],
  }

  let cursor = at + fixedEnd
  if (status & STATUS.nullBitmap) {
    if (cursor + 2 > PAGE_SIZE) return null
    record.columnCount = view.getUint16(cursor, true)
    cursor += 2
    const size = Math.ceil(record.columnCount / 8)
    if (cursor + size > PAGE_SIZE) return null
    record.nullBitmap = page.subarray(cursor, cursor + size)
    cursor += size
  }

  if (status & STATUS.variable) {
    if (cursor + 2 > PAGE_SIZE) return null
    const count = view.getUint16(cursor, true)
    cursor += 2
    if (cursor + count * 2 > PAGE_SIZE) return null

    let start = cursor + count * 2 - at
    for (let i = 0; i < count; i++) {
      const entry = view.getUint16(cursor + i * 2, true)
      const end = entry & 0x7fff
      if (end < start || at + end > PAGE_SIZE) return null
      record.variable.push(page.subarray(at + start, at + end))
      record.complex.push((entry & COMPLEX) !== 0)
      start = end
    }
  }

  return record
}

export function isNullAt(record: Record, nullBit: number): boolean {
  if (nullBit < 1 || !record.nullBitmap) return false
  if (nullBit > record.columnCount) return true
  const byte = record.nullBitmap[(nullBit - 1) >> 3] as number
  return ((byte >> ((nullBit - 1) & 7)) & 1) === 1
}
