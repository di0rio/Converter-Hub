import { SqliteReadError } from '../sqlite/index.js'

// Layouts follow Firebird's own source (ods.h, sqz.cpp, dpm.epp, tpc.cpp,
// blb.cpp): 2.5 for ODS 11, 5.0 for ODS 13. The file is untrusted, so every read is bounds-checked.

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
  stream: 32,
  delta: 32,
  damaged: 128,
  /** Transaction id needs 64 bits, so the header carries its high half. */
  longTranum: 1024,
  /** The record did not compress, so it is stored as it is. */
  notPacked: 2048,
} as const

const RHD_SIZE = 13
/** `rhd` plus the high half of the transaction id, aligned. */
const RHDE_SIZE = 16
const RHDF_SIZE = 22

/**
 * How much of a record slot is header rather than data.
 *
 * A fragment always carries the full header, because it has to point at the
 * next piece. Otherwise Firebird 3 and later widen it by two bytes when the
 * transaction id no longer fits in 32 bits.
 */
function headerSize(flags: number): number {
  if (flags & RHD.incomplete) return RHDF_SIZE
  return flags & RHD.longTranum ? RHDE_SIZE : RHD_SIZE
}
const BLH_SIZE = 28
const BLP_SIZE = 28
const HDR_FILE = 3

/**
 * Where `hdr_data` begins — the clumplets that say whether the database
 * continues in other files.
 *
 * The header page grew in ODS 13: Firebird 4 added `hdr_crypt_plugin`,
 * `hdr_att_high` and the high words of the transaction counters ahead of it.
 * Reading the clumplets from the old offset would walk into those fields and
 * see whatever they happen to contain.
 */
function headerDataOffset(major: number): number {
  return major >= 13 ? 128 : 96
}

/** On-disk structures this reader knows how to walk. */
const SUPPORTED_ODS = new Set([11, 13])

const MAX_RECORD = 65536

export const FDB_HEADER_BYTES = 20

export interface FdbHeader {
  pageSize: number
  odsMajor: number
  odsMinor: number
  odsMinorOriginal: number
  pagesPointer: number
  oldestTransaction: number
  nextTransaction: number
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function validPageSize(size: number): boolean {
  return size >= 1024 && size <= 16384 && (size & (size - 1)) === 0
}

export function isFdbFile(head: Uint8Array): boolean {
  if (head.length < FDB_HEADER_BYTES || head[0] !== PAG_HEADER) return false
  const v = view(head)
  const major = v.getUint16(18, true) & 0x7fff
  return validPageSize(v.getUint16(16, true)) && major >= 8 && major <= 13
}

function writtenBy(major: number): string {
  if (major === 10) return 'Firebird 1.x'
  if (major === 11) return 'Firebird 2.x'
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
      'This database was written by InterBase, not Firebird. This tool reads Firebird 2.x and 4/5 databases (ODS 11 and 13).',
    )
  }
  if (!SUPPORTED_ODS.has(major)) {
    throw new FdbReadError(
      `This Firebird database was written by ${writtenBy(major)} (ODS ${major}). This tool reads ODS 11 and ODS 13 — Firebird 2.x, 4 and 5.`,
    )
  }

  const pageSize = v.getUint16(16, true)
  const end = Math.min(v.getUint16(66, true), pageSize)
  for (let p = headerDataOffset(major); p + 1 < end; ) {
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

/**
 * Undo the run-length encoding a record is stored in.
 *
 * A negative control byte is a run of one repeated byte, a positive one a
 * literal stretch. Firebird 3 extended that: because its compressor never
 * emits a run shorter than a few bytes, it was free to give -1 and -2 a new
 * meaning — a run whose length follows as a 16- or 32-bit number, which lets
 * one control byte cover a run longer than 127. Reading an ODS 12+ record with
 * the older rules walks straight off the end of the buffer, and reading an
 * ODS 11 record with the newer ones would turn a legitimate run of one into an
 * escape, so which rules apply is decided by the database, not guessed.
 */
export function decompress(
  input: Uint8Array,
  limit = MAX_RECORD,
  extended = false,
): Uint8Array {
  const out = new Uint8Array(limit)
  const v = view(input)
  let o = 0
  let i = 0
  while (i < input.length) {
    const len = ((input[i++] as number) << 24) >> 24
    if (len < 0) {
      let run = -len
      if (extended && (len === -1 || len === -2)) {
        const width = len === -1 ? 2 : 4
        if (i + width > input.length) throw damaged('rle overrun')
        run = len === -1 ? v.getUint16(i, true) : v.getUint32(i, true)
        i += width
      }
      if (i >= input.length || o + run > limit) throw damaged('rle overrun')
      out.fill(input[i++] as number, o, o + run)
      o += run
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
  // Firebird pads a difference record with zeros; only a non-zero tail is a
  // sign that something is wrong.
  while (d < diff.length) {
    if (diff[d++] !== 0) throw damaged('bad difference record')
  }
  if (p > out.length) throw damaged('bad difference record')
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

export interface RawRecord {
  page: number
  line: number
  flags: number
  transaction: number
  backPage: number
  backLine: number
  format: number
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
    // ODS 12 widened the per-data-page flags from 2 bits to 8 and rounded the
    // count down to whole extents of 8 pages.
    this.dpPerPp =
      header.odsMajor >= 12
        ? Math.floor(((size - 32) * 8) / 40) & ~7
        : Math.floor(((size - 32) * 8) / 34)
    this.transPerTip = (size - 20) * 4
  }

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

  dataPages(pointer: number): number[] {
    const o = this.page(pointer, PAG_POINTER)
    const count = this.u16(o + 24)
    if (32 + count * 4 > this.header.pageSize) {
      throw damaged(`pointer page ${pointer} overflows`)
    }
    return Array.from({ length: count }, (_, i) => this.u32(o + 32 + i * 4))
  }

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

  record(page: number, line: number): RawRecord | null {
    const slot = this.slot(page, line)
    if (!slot) return null
    const r = slot.at
    const flags = this.u16(r + 10)
    const incomplete = (flags & RHD.incomplete) !== 0
    const size = headerSize(flags)
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

  /** ODS 12 introduced the extended run-length escapes. */
  private get extendedRle(): boolean {
    return this.header.odsMajor >= 12
  }

  /** The bytes of one record or fragment, packed or not. */
  private unpack(record: RawRecord, limit = MAX_RECORD): Uint8Array {
    return record.flags & RHD.notPacked
      ? record.data.subarray(0, Math.min(record.data.length, limit))
      : decompress(record.data, limit, this.extendedRle)
  }

  expand(record: RawRecord): Uint8Array {
    const parts = [this.unpack(record)]
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
      const part = this.unpack(next, MAX_RECORD - total)
      total += part.length
      parts.push(part)
      r = next
    }
    return parts.length === 1 ? (parts[0] as Uint8Array) : concat(parts)
  }

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
