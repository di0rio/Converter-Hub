import { SqliteReadError } from '../sqlite/index.js'

/**
 * The on-disk structure of a Firebird 2.x database (ODS 11), read directly.
 *
 * Every layout and constant here is taken from Firebird 2.5's own source -
 * `ods.h` for the structures, `sqz.cpp` for record compression, `dpm.epp` for
 * record and fragment access, `tpc.cpp` for transaction states, `blb.cpp` for
 * blobs - and every read is bounds-checked, because the file is untrusted.
 */

/**
 * Thrown when a Firebird database cannot be read.
 *
 * It extends `SqliteReadError` so the app shows its message the way it shows
 * the SQLite reader's. The message is fixed text and never quotes the file;
 * `detail` names the internal step for diagnostics and is never shown in the
 * app.
 */
export class FdbReadError extends SqliteReadError {
  readonly detail: string

  constructor(message: string, detail = '') {
    super(message)
    this.detail = detail
  }
}

const DAMAGED = 'This Firebird database is damaged or incomplete.'

export function damaged(detail: string): FdbReadError {
  return new FdbReadError(DAMAGED, detail)
}

// ------------------------------------------------------------ constants

const PAG_HEADER = 1
const PAG_TRANSACTIONS = 3
const PAG_POINTER = 4
const PAG_DATA = 5
const PAG_BLOB = 8

export const RHD = {
  deleted: 1,
  chain: 2,
  fragment: 4,
  incomplete: 8,
  blob: 16,
  /** On a blob: stored as a stream, not segments. */
  stream: 32,
  /** On a record: its back version is a difference string. */
  delta: 32,
  damaged: 128,
} as const

const RHD_SIZE = 13
const RHDF_SIZE = 22
const BLH_SIZE = 28
const BLP_SIZE = 28
const HDR_DATA = 96
const HDR_FILE = 3

/** A record is at most 64 KB once expanded; nothing legitimate is longer. */
const MAX_RECORD = 65536

/** How many bytes `isFdbFile` needs. */
export const FDB_HEADER_BYTES = 20

// ---------------------------------------------------------------- header

export interface FdbHeader {
  pageSize: number
  odsMajor: number
  odsMinor: number
  /** The ODS minor version the database was created with. */
  odsMinorOriginal: number
  /** First pointer page of RDB$PAGES. */
  pagesPointer: number
  /** Oldest interesting transaction: everything below it committed. */
  oldestTransaction: number
  nextTransaction: number
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function validPageSize(size: number): boolean {
  return size >= 1024 && size <= 16384 && (size & (size - 1)) === 0
}

/**
 * Whether these bytes begin a Firebird or InterBase database, of any version.
 * Versions this tool cannot read still count, so they are refused by name
 * rather than treated as an unknown file.
 */
export function isFdbFile(head: Uint8Array): boolean {
  if (head.length < FDB_HEADER_BYTES || head[0] !== PAG_HEADER) return false
  const v = view(head)
  const major = v.getUint16(18, true) & 0x7fff
  return validPageSize(v.getUint16(16, true)) && major >= 8 && major <= 13
}

function writtenBy(major: number): string {
  if (major === 10) return 'Firebird 1.x'
  if (major === 12) return 'Firebird 3'
  if (major === 13) return 'Firebird 4 or 5'
  return 'an older InterBase'
}

export function readHeader(bytes: Uint8Array): FdbHeader {
  if (bytes.length < 1024 || !isFdbFile(bytes)) {
    throw new FdbReadError('This file is not a Firebird database.')
  }
  const v = view(bytes)
  const ods = v.getUint16(18, true)
  const major = ods & 0x7fff
  if (!(ods & 0x8000)) {
    throw new FdbReadError(
      'This database was written by InterBase, not Firebird. This tool reads Firebird 2.x databases (ODS 11).',
    )
  }
  if (major !== 11) {
    throw new FdbReadError(
      `This Firebird database was written by ${writtenBy(major)} (ODS ${major}). This tool reads Firebird 2.x databases (ODS 11).`,
    )
  }

  const pageSize = v.getUint16(16, true)
  const end = Math.min(v.getUint16(66, true), pageSize)
  for (let p = HDR_DATA; p + 1 < end; ) {
    const type = bytes[p] as number
    if (type === 0) break
    if (type === HDR_FILE) {
      throw new FdbReadError(
        'This Firebird database continues in other files. This tool reads single-file databases.',
      )
    }
    p += 2 + (bytes[p + 1] as number)
  }

  return {
    pageSize,
    odsMajor: major,
    odsMinor: v.getUint16(62, true),
    odsMinorOriginal: v.getUint16(64, true),
    pagesPointer: v.getUint32(20, true),
    oldestTransaction: v.getUint32(28, true),
    nextTransaction: v.getUint32(36, true),
  }
}

// ----------------------------------------------------------- compression

/**
 * Expand a compressed record (SQZ_decompress). A negative control byte repeats
 * the next byte that many times; a positive one copies that many bytes.
 */
export function decompress(input: Uint8Array, limit = MAX_RECORD): Uint8Array {
  const out = new Uint8Array(limit)
  let o = 0
  let i = 0
  while (i < input.length) {
    const len = ((input[i++] as number) << 24) >> 24
    if (len < 0) {
      if (i >= input.length || o - len > limit) throw damaged('rle overrun')
      out.fill(input[i++] as number, o, o - len)
      o -= len
    } else {
      if (o + len > limit || i + len > input.length) {
        throw damaged('rle overrun')
      }
      out.set(input.subarray(i, i + len), o)
      o += len
      i += len
    }
  }
  return out.subarray(0, o)
}

/**
 * Rebuild an older record version from a newer one (SQZ_apply_differences).
 * A positive control byte replaces that many bytes; a negative one keeps them.
 */
export function applyDifferences(
  base: Uint8Array,
  diff: Uint8Array,
): Uint8Array {
  const out = base.slice()
  let p = 0
  let d = 0
  while (d < diff.length && p < out.length) {
    const l = ((diff[d++] as number) << 24) >> 24
    if (l > 0) {
      if (p + l > out.length || d + l > diff.length) {
        throw damaged('bad difference record')
      }
      out.set(diff.subarray(d, d + l), p)
      p += l
      d += l
    } else {
      p -= l
    }
  }
  if (p > out.length || d < diff.length) throw damaged('bad difference record')
  return out.subarray(0, p)
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let o = 0
  for (const part of parts) {
    out.set(part, o)
    o += part.length
  }
  return out
}

// ----------------------------------------------------------------- file

export interface RawRecord {
  page: number
  line: number
  flags: number
  transaction: number
  backPage: number
  backLine: number
  format: number
  /** Compressed data of this piece. */
  data: Uint8Array
  fragmentPage: number
  fragmentLine: number
}

export interface Blob {
  subType: number
  charset: number
  data: Uint8Array
}

export class FdbFile {
  readonly header: FdbHeader
  private readonly bytes: Uint8Array
  private readonly v: DataView
  private readonly maxRecords: number
  private readonly dpPerPp: number
  private readonly transPerTip: number
  private tips: number[] = []

  constructor(bytes: Uint8Array, header: FdbHeader) {
    this.bytes = bytes
    this.header = header
    this.v = view(bytes)
    const size = header.pageSize
    this.maxRecords = Math.floor((size - 28) / (4 + RHD_SIZE))
    this.dpPerPp = Math.floor(((size - 32) * 8) / 34)
    this.transPerTip = (size - 20) * 4
  }

  /** The byte offset of a page, after checking it exists and has this type. */
  private page(number: number, type: number): number {
    const offset = number * this.header.pageSize
    if (number <= 0 || offset + this.header.pageSize > this.bytes.length) {
      throw damaged(`page ${number} is outside the file`)
    }
    if (this.bytes[offset] !== type) {
      throw damaged(
        `page ${number} has type ${this.bytes[offset]}, not ${type}`,
      )
    }
    return offset
  }

  private u16(offset: number): number {
    return this.v.getUint16(offset, true)
  }

  private u32(offset: number): number {
    return this.v.getUint32(offset, true)
  }

  /** A relation's pointer pages, in order, starting from its first. */
  pointerPages(first: number, relation: number): number[] {
    const pages: number[] = []
    const seen = new Set<number>()
    for (let n = first; n; ) {
      if (seen.has(n)) throw damaged('pointer page chain loops')
      seen.add(n)
      const o = this.page(n, PAG_POINTER)
      if (this.u16(o + 26) !== relation) {
        throw damaged(`pointer page ${n} belongs to another relation`)
      }
      pages.push(n)
      n = this.u32(o + 20)
    }
    return pages
  }

  /** The data page in each slot of a pointer page; 0 where the slot is empty. */
  dataPages(pointer: number): number[] {
    const o = this.page(pointer, PAG_POINTER)
    const count = this.u16(o + 24)
    if (32 + count * 4 > this.header.pageSize) {
      throw damaged(`pointer page ${pointer} overflows`)
    }
    return Array.from({ length: count }, (_, i) => this.u32(o + 32 + i * 4))
  }

  /** How many record slots a data page has, after checking its relation. */
  lineCount(page: number, relation: number): number {
    const o = this.page(page, PAG_DATA)
    if (this.u16(o + 20) !== relation) {
      throw damaged(`data page ${page} belongs to another relation`)
    }
    return this.u16(o + 22)
  }

  private slot(
    page: number,
    line: number,
  ): { at: number; length: number } | null {
    const o = this.page(page, PAG_DATA)
    const size = this.header.pageSize
    if (line >= this.u16(o + 22)) return null
    if (24 + (line + 1) * 4 > size) throw damaged(`data page ${page} overflows`)
    const offset = this.u16(o + 24 + line * 4)
    const length = this.u16(o + 26 + line * 4)
    if (offset === 0) return null
    if (offset + length > size)
      throw damaged(`record ${page}:${line} overflows`)
    return { at: o + offset, length }
  }

  /** One record piece as stored, or null for an empty slot. */
  record(page: number, line: number): RawRecord | null {
    const slot = this.slot(page, line)
    if (!slot) return null
    const r = slot.at
    const flags = this.u16(r + 10)
    const incomplete = (flags & RHD.incomplete) !== 0
    const size = incomplete ? RHDF_SIZE : RHD_SIZE
    if (slot.length < size) throw damaged(`record ${page}:${line} is truncated`)
    return {
      page,
      line,
      flags,
      transaction: this.u32(r),
      backPage: this.u32(r + 4),
      backLine: this.u16(r + 8),
      format: this.bytes[r + 12] as number,
      data: this.bytes.subarray(r + size, r + slot.length),
      fragmentPage: incomplete ? this.u32(r + 16) : 0,
      fragmentLine: incomplete ? this.u16(r + 20) : 0,
    }
  }

  /** A record's full data: every fragment, each decompressed on its own. */
  expand(record: RawRecord): Uint8Array {
    const parts = [decompress(record.data)]
    let total = parts[0]?.length ?? 0
    const seen = new Set<string>()
    for (let r = record; r.flags & RHD.incomplete; ) {
      const key = `${r.fragmentPage}:${r.fragmentLine}`
      if (!r.fragmentPage || seen.has(key))
        throw damaged('broken fragment chain')
      seen.add(key)
      const next = this.record(r.fragmentPage, r.fragmentLine)
      if (!next || !(next.flags & RHD.fragment)) {
        throw damaged('missing record fragment')
      }
      const part = decompress(next.data, MAX_RECORD - total)
      total += part.length
      parts.push(part)
      r = next
    }
    return parts.length === 1 ? (parts[0] as Uint8Array) : concat(parts)
  }

  /** Set the transaction inventory pages, by sequence, from RDB$PAGES. */
  setTips(first: number): void {
    const pages: number[] = []
    const seen = new Set<number>()
    for (let n = first; n; ) {
      if (seen.has(n)) throw damaged('transaction page chain loops')
      seen.add(n)
      pages.push(n)
      n = this.u32(this.page(n, PAG_TRANSACTIONS) + 16)
    }
    this.tips = pages
  }

  /** Whether a transaction committed, as the engine's TPC would say. */
  committed(transaction: number): boolean {
    if (transaction === 0) return true
    if (transaction >= this.header.nextTransaction) return false
    if (transaction < this.header.oldestTransaction) return true
    const page = this.tips[Math.floor(transaction / this.transPerTip)]
    if (page === undefined)
      throw damaged(`no inventory for transaction ${transaction}`)
    const o = this.page(page, PAG_TRANSACTIONS)
    const byte = this.bytes[
      o + 20 + ((transaction % this.transPerTip) >> 2)
    ] as number
    return ((byte >> ((transaction & 3) << 1)) & 3) === 3
  }

  /** A blob, located by its record number among its relation's pages. */
  blob(pointers: readonly number[], number: number): Blob {
    const line = number % this.maxRecords
    const sequence = Math.floor(number / this.maxRecords)
    const pointer = pointers[Math.floor(sequence / this.dpPerPp)]
    if (pointer === undefined) throw damaged('blob outside its relation')
    const data = this.dataPages(pointer)[sequence % this.dpPerPp]
    if (!data) throw damaged('blob on a missing page')
    const slot = this.slot(data, line)
    if (!slot || slot.length < BLH_SIZE) throw damaged('missing blob')

    const r = slot.at
    const flags = this.u16(r + 10)
    if (!(flags & RHD.blob) || flags & RHD.damaged) throw damaged('not a blob')
    const level = this.bytes[r + 12] as number
    const maxSequence = this.u32(r + 4)
    const payload = this.bytes.subarray(r + BLH_SIZE, r + slot.length)

    let stream: Uint8Array
    if (level === 0) {
      stream = payload
    } else {
      if (level > 2 || maxSequence * this.header.pageSize > this.bytes.length) {
        throw damaged('blob page vector is implausible')
      }
      const vector = (i: number): number => {
        if ((i + 1) * 4 > payload.length)
          throw damaged('blob page vector overflows')
        return this.u32(r + BLH_SIZE + i * 4)
      }
      const pointersPerPage = Math.floor((this.header.pageSize - BLP_SIZE) / 4)
      const parts: Uint8Array[] = []
      for (let i = 0; i <= maxSequence; i++) {
        const page =
          level === 1
            ? vector(i)
            : this.u32(
                this.page(vector(Math.floor(i / pointersPerPage)), PAG_BLOB) +
                  BLP_SIZE +
                  (i % pointersPerPage) * 4,
              )
        const o = this.page(page, PAG_BLOB)
        const length = this.u16(o + 24)
        if (BLP_SIZE + length > this.header.pageSize)
          throw damaged('blob page overflows')
        parts.push(this.bytes.subarray(o + BLP_SIZE, o + BLP_SIZE + length))
      }
      stream = concat(parts)
    }

    return {
      subType: this.u16(r + 24),
      charset: this.bytes[r + 26] as number,
      data: flags & RHD.stream ? stream : joinSegments(stream),
    }
  }
}

/** A segmented blob's data: each segment is prefixed with its u16 length. */
function joinSegments(stream: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = []
  const v = view(stream)
  for (let i = 0; i < stream.length; ) {
    if (i + 2 > stream.length) throw damaged('truncated blob segment')
    const length = v.getUint16(i, true)
    i += 2
    if (i + length > stream.length) throw damaged('truncated blob segment')
    parts.push(stream.subarray(i, i + length))
    i += length
  }
  return concat(parts)
}
