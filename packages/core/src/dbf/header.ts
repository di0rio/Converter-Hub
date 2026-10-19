import { SqliteReadError } from '../sqlite/index.js'

/**
 * Layouts follow the dBase and FoxPro file specifications: the 32-byte table
 * header, the 32-byte field descriptors that follow it, and the 8-byte header
 * with 16-byte descriptors that dBase II used. The file is untrusted, so every
 * read is bounds-checked.
 */
export class DbfReadError extends SqliteReadError {
  readonly detail: string

  constructor(message: string, detail = '') {
    super(message)
    this.detail = detail
  }
}

const DAMAGED = 'This dBase table is damaged or incomplete.'

export function damaged(detail: string): DbfReadError {
  return new DbfReadError(DAMAGED, detail)
}

export const DBF_HEADER_BYTES = 32

/** dBase II keeps the record count in 16 bits and its data at a fixed offset. */
const DBASE2 = 0x02
const DBASE2_DATA_OFFSET = 521
const DBASE2_MAX_FIELDS = 32

const FIELD_TERMINATOR = 0x0d

/** Table files this reader knows how to walk, by their first byte. */
const VERSIONS = new Set([
  DBASE2,
  0x03,
  0x04,
  0x05,
  0x07,
  0x30,
  0x31,
  0x32,
  0x43,
  0x63,
  0x7b,
  0x83,
  0x8b,
  0x8c,
  0x8e,
  0xcb,
  0xf5,
  0xfb,
])

/** Versions whose memo file is a FoxPro `.fpt` rather than a dBase `.dbt`. */
const FOXPRO = new Set([0x30, 0x31, 0x32, 0xf5])

/** Versions whose `.dbt` carries a per-block header, as dBase IV writes it. */
const DBASE4_MEMO = new Set([0x7b, 0x8b, 0x8c, 0x8e, 0xcb])

/** Versions that name a memo file in the version byte itself. */
const WITH_MEMO = new Set([0x7b, 0x83, 0x8b, 0x8c, 0x8e, 0xcb, 0xf5])

/** The flag byte at offset 28 says so for Visual FoxPro. */
const FLAG_MEMO = 0x02

export type MemoLayout = 'dbase3' | 'dbase4' | 'foxpro'

export interface DbfField {
  name: string
  /** The one-letter field type, upper-cased. */
  type: string
  /** Where the field starts inside a record, past the deletion marker. */
  offset: number
  length: number
  decimals: number
  nullable: boolean
  binary: boolean
  system: boolean
}

export interface DbfHeader {
  version: number
  recordCount: number
  recordLength: number
  dataOffset: number
  /** The language driver byte, or 0 when the writer left it unset. */
  languageDriver: number
  memoLayout: MemoLayout
  namesMemo: boolean
  fields: DbfField[]
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function plausibleDate(month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

export function isDbfFile(head: Uint8Array): boolean {
  if (head.length < DBF_HEADER_BYTES) return false
  const version = head[0] as number
  if (!VERSIONS.has(version)) return false
  const v = view(head)

  if (version === DBASE2) {
    return (
      plausibleDate(head[3] as number, head[4] as number) &&
      v.getUint16(6, true) >= 1
    )
  }

  // 32 bytes of table header, at least one 32-byte field descriptor and the
  // terminator. Visual FoxPro appends a 263-byte back-link past it.
  const headerLength = v.getUint16(8, true)
  return (
    plausibleDate(head[2] as number, head[3] as number) &&
    headerLength >= DBF_HEADER_BYTES + 33 &&
    v.getUint16(10, true) >= 1
  )
}

function fieldName(bytes: Uint8Array): string {
  let end = bytes.length
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      end = i
      break
    }
  }
  let text = ''
  for (let i = 0; i < end; i++) text += String.fromCharCode(bytes[i] as number)
  return text.trim()
}

function readDbase2(bytes: Uint8Array): DbfHeader {
  const v = view(bytes)
  const recordLength = v.getUint16(6, true)
  const fields: DbfField[] = []
  let offset = 1

  for (let i = 0; i < DBASE2_MAX_FIELDS; i++) {
    const at = 8 + i * 16
    if (at + 16 > bytes.length || bytes[at] === FIELD_TERMINATOR) break
    const length = bytes[at + 12] as number
    fields.push({
      name: fieldName(bytes.subarray(at, at + 11)),
      type: String.fromCharCode(bytes[at + 11] as number).toUpperCase(),
      offset,
      length,
      decimals: bytes[at + 15] as number,
      nullable: false,
      binary: false,
      system: false,
    })
    offset += length
  }

  if (fields.length === 0) throw damaged('no fields in the header')
  return {
    version: DBASE2,
    recordCount: v.getUint16(1, true),
    recordLength,
    dataOffset: DBASE2_DATA_OFFSET,
    languageDriver: 0,
    memoLayout: 'dbase3',
    namesMemo: false,
    fields,
  }
}

export function readDbfHeader(bytes: Uint8Array): DbfHeader {
  if (!isDbfFile(bytes)) {
    throw new DbfReadError('This file is not a dBase or FoxPro table.')
  }
  const version = bytes[0] as number
  if (version === DBASE2) return readDbase2(bytes)

  const v = view(bytes)
  const headerLength = v.getUint16(8, true)
  const recordLength = v.getUint16(10, true)
  if (headerLength > bytes.length) throw damaged('header past the end of file')

  const fields: DbfField[] = []
  let offset = 1

  for (let at = DBF_HEADER_BYTES; at + 32 <= headerLength; at += 32) {
    if (bytes[at] === FIELD_TERMINATOR) break
    const type = String.fromCharCode(bytes[at + 11] as number).toUpperCase()
    const flags = bytes[at + 18] as number
    let length = bytes[at + 16] as number
    let decimals = bytes[at + 17] as number

    // A character field wider than 255 bytes borrows the decimal byte for the
    // high half of its length, as dBase and Clipper wrote it.
    if (type === 'C' && decimals > 0) {
      length += decimals * 256
      decimals = 0
    }

    fields.push({
      name: fieldName(bytes.subarray(at, at + 11)),
      type,
      offset,
      length,
      decimals,
      nullable: (flags & 0x02) !== 0,
      binary: (flags & 0x04) !== 0,
      system: (flags & 0x01) !== 0,
    })
    offset += length
  }

  if (fields.length === 0) throw damaged('no fields in the header')
  if (offset > recordLength) {
    throw damaged('fields are wider than the record length')
  }

  return {
    version,
    recordCount: v.getUint32(4, true),
    recordLength,
    dataOffset: headerLength,
    languageDriver: bytes[29] as number,
    memoLayout: FOXPRO.has(version)
      ? 'foxpro'
      : DBASE4_MEMO.has(version)
        ? 'dbase4'
        : 'dbase3',
    namesMemo:
      WITH_MEMO.has(version) || ((bytes[28] as number) & FLAG_MEMO) !== 0,
    fields,
  }
}

/**
 * What wrote the table, for the note shown next to an unreadable one, or
 * undefined when the first byte names nothing this reader knows.
 */
export function writtenBy(version: number): string | undefined {
  if (version === DBASE2) return 'dBase II'
  if (version === 0x03) return 'dBase III+ or FoxBASE+'
  if (version === 0x04 || version === 0x05) return 'dBase 5 or 7'
  if (FOXPRO.has(version)) return 'FoxPro'
  if (version === 0xfb) return 'FoxBASE'
  if (DBASE4_MEMO.has(version) || version === 0x43 || version === 0x63) {
    return 'dBase IV'
  }
  return undefined
}
