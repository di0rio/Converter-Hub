import {
  SqliteReadError,
  type SqliteColumn,
  type SqliteDatabase,
  type SqliteTable,
  type SqliteValue,
  type UnreadableTable,
} from '../sqlite/index.js'
import { declaredType, type FieldInfo, quote } from '../fdb/index.js'
import { decodeDecFloat, TIME_TZ_BASE_DATE } from '../fdb/modern.js'
import { inflateZlib } from './inflate.js'
import {
  CHARSET_IDS,
  decodeText,
  formatDate,
  formatTime,
  readableCharset,
  scaled,
  trimPad,
  WIN1252,
  withTimeZone,
} from '../fdb/values.js'

// Reading a gbak backup without restoring it, following Firebird's own
// reader of the format (burp/restore.epp, canonical.cpp, mvol.cpp).
//
// The file is a stream of records. Each is a type byte and, for most types, a
// list of attributes closed by a zero: an attribute byte, a length byte and
// that many bytes. Blob-valued attributes are the exception — their length is
// itself such an attribute, followed by that many bytes — and so is one long
// message, with a two-byte length. Which attributes those are depends on the
// record type, so they are listed below, taken from what restore.epp reads with
// its blob and long-text helpers. Everything else is skipped by its length,
// which is what gbak does with an attribute it does not know.
//
// Table rows are XDR: each stored column in turn, big-endian and padded to
// four bytes, then one null flag per column. Blobs follow their row as
// records of their own.

export class FbkReadError extends SqliteReadError {
  readonly detail: string

  constructor(message: string, detail = '') {
    super(message)
    this.detail = detail
  }
}

const DAMAGED = 'This Firebird backup is damaged or incomplete.'

function damaged(detail: string): FbkReadError {
  return new FbkReadError(DAMAGED, detail)
}

const REC = {
  burp: 0,
  database: 1,
  globalField: 2,
  relation: 3,
  field: 4,
  index: 5,
  data: 6,
  blob: 7,
  relationData: 8,
  relationEnd: 9,
  end: 10,
  view: 11,
  trigger: 13,
  function: 15,
  functionArg: 16,
  functionEnd: 17,
  genId: 18,
  systemType: 19,
  filter: 20,
  array: 23,
  generator: 26,
  procedure: 27,
  procedurePrm: 28,
  procedureEnd: 29,
  exception: 30,
  securityClass: 12,
  charset: 34,
  collation: 35,
  sqlRoles: 36,
  mapping: 37,
  package: 38,
} as const

/** Attributes whose value is a blob: a length attribute, then the bytes. */
const BLOB_ATTRIBUTES: Partial<Record<number, ReadonlySet<number>>> = {
  [REC.database]: new Set([6, 10]),
  [REC.globalField]: new Set([
    6, 15, 16, 17, 18, 19, 20, 21, 35, 36, 37, 39, 40,
  ]),
  [REC.relation]: new Set([2, 3, 9, 11, 13, 14, 15]),
  [REC.field]: new Set([6, 15, 16, 35, 39]),
  [REC.index]: new Set([6, 9, 10, 11, 12, 13]),
  [REC.securityClass]: new Set([12, 13, 19]),
  [REC.trigger]: new Set([2, 3, 7, 10, 11, 14]),
  [REC.function]: new Set([2, 9, 13, 14, 16]),
  [REC.functionArg]: new Set([13, 14, 20]),
  [REC.systemType]: new Set([4, 13]),
  [REC.filter]: new Set([7, 12]),
  [REC.generator]: new Set([4]),
  [REC.procedure]: new Set([4, 5, 6, 7, 8, 13]),
  [REC.procedurePrm]: new Set([5, 6, 7, 8]),
  [REC.exception]: new Set([3, 4]),
  [REC.charset]: new Set([7]),
  [REC.collation]: new Set([7, 10]),
  [REC.sqlRoles]: new Set([3]),
  [REC.mapping]: new Set([10]),
  [REC.package]: new Set([2, 3, 7]),
}

/** Attributes whose value has a two-byte length: an exception's message. */
const LONG_TEXT_ATTRIBUTES: Partial<Record<number, ReadonlySet<number>>> = {
  [REC.exception]: new Set([5]),
}

const ATT = {
  end: 0,
  // rec_burp
  backupFormat: 2,
  backupCompress: 4,
  backupTransportable: 5,
  backupKeyname: 9,
  backupZip: 10,
  backupHash: 11,
  backupCrypt: 12,
  // rec_database
  databaseCharset: 11,
  // rec_relation
  relationName: 1,
  relationViewBlr: 2,
  relationSystemFlag: 7,
  relationExternalFile: 17,
  relationType: 18,
  // rec_global_field and rec_field
  fieldName: 1,
  fieldSource: 2,
  fieldType: 8,
  fieldSubType: 9,
  fieldLength: 10,
  fieldScale: 11,
  fieldPosition: 13,
  fieldComputedBlr: 18,
  fieldNumber: 22,
  fieldComputed: 23,
  fieldDimensions: 29,
  fieldNullFlag: 38,
  fieldCharLength: 41,
  fieldCharset: 42,
  fieldPrecision: 44,
  // rec_data
  dataLength: 1,
  dataData: 2,
  xdrLength: 17,
  xdrArray: 18,
  // rec_blob and rec_array
  blobFieldNumber: 3,
  blobData: 7,
} as const

/** The newest backup format gbak writes, Firebird 4 and 5's. */
const MAX_FORMAT = 11

/** A parsed attribute list: the first value of each attribute. */
type Attributes = Map<number, Uint8Array>

class Stream {
  private at = 0

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.at >= this.bytes.length
  }

  byte(): number {
    const value = this.bytes[this.at]
    if (value === undefined) throw damaged('backup ends early')
    this.at++
    return value
  }

  take(length: number): Uint8Array {
    if (length < 0 || this.at + length > this.bytes.length) {
      throw damaged('backup ends early')
    }
    const value = this.bytes.subarray(this.at, this.at + length)
    this.at += length
    return value
  }

  /** A little-endian integer of `length` bytes, sign-extended. */
  vax(length: number): number {
    const bytes = this.take(length)
    return littleEndian(bytes)
  }

  u32(): number {
    return this.vax(4) >>> 0
  }

  /** An attribute value holding an integer: a length byte, then the bytes. */
  integer(): number {
    return this.vax(this.byte())
  }

  /** Undo gbak's run-length encoding until `length` bytes come out. */
  expand(length: number): Uint8Array {
    const out = new Uint8Array(length)
    let o = 0
    while (o < length) {
      const count = (this.byte() << 24) >> 24
      if (count > 0) {
        const n = Math.min(count, length - o)
        out.set(this.take(n), o)
        o += n
      } else if (count < 0) {
        const n = Math.min(-count, length - o)
        out.fill(this.byte(), o, o + n)
        o += n
      }
    }
    return out
  }

  attributes(record: number, stop: number = ATT.end): Attributes {
    const blobs = BLOB_ATTRIBUTES[record]
    const longText = LONG_TEXT_ATTRIBUTES[record]
    const found: Attributes = new Map()
    for (;;) {
      const attribute = this.byte()
      if (attribute === stop) return found
      let value: Uint8Array
      if (blobs?.has(attribute)) {
        value = this.take(this.integer())
      } else if (longText?.has(attribute)) {
        value = this.take(this.vax(2) & 0xffff)
      } else {
        value = this.take(this.byte())
      }
      if (!found.has(attribute)) found.set(attribute, value)
    }
  }
}

function littleEndian(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0
  let value = 0
  for (let i = bytes.length - 1; i >= 0; i--) {
    value = value * 256 + (bytes[i] as number)
  }
  const top = 2 ** (8 * bytes.length)
  return (bytes[bytes.length - 1] as number) & 0x80 ? value - top : value
}

const utf8 = new TextDecoder()

function text(attributes: Attributes, attribute: number): string | null {
  const value = attributes.get(attribute)
  return value ? utf8.decode(value).replace(/[ \0]+$/, '') : null
}

function integer(attributes: Attributes, attribute: number): number | null {
  const value = attributes.get(attribute)
  return value ? littleEndian(value) : null
}

/** A row's XDR encoding, read front to back. */
class Xdr {
  private at = 0
  private readonly v: DataView

  constructor(private readonly bytes: Uint8Array) {
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  private need(length: number): number {
    const at = this.at
    if (at + length > this.bytes.length) throw damaged('row ends early')
    this.at += length
    return at
  }

  int32(): number {
    return this.v.getInt32(this.need(4))
  }

  uint32(): number {
    return this.v.getUint32(this.need(4))
  }

  hyper(): bigint {
    return this.v.getBigInt64(this.need(8))
  }

  float(): number {
    return this.v.getFloat32(this.need(4))
  }

  double(): number {
    return this.v.getFloat64(this.need(8))
  }

  /** `length` bytes, then padding to a multiple of four. */
  opaque(length: number): Uint8Array {
    const at = this.need(length)
    this.need((4 - (length & 3)) & 3)
    return this.bytes.subarray(at, at + length)
  }

  /** A big-endian value read back in the byte order Firebird stores it. */
  reversed(length: number): DataView {
    const at = this.need(length)
    return new DataView(this.bytes.slice(at, at + length).reverse().buffer)
  }
}

// BLR type codes, which are also RDB$FIELD_TYPE's.
const BLR = {
  short: 7,
  long: 8,
  quad: 9,
  float: 10,
  dFloat: 11,
  date: 12,
  time: 13,
  text: 14,
  int64: 16,
  boolean: 23,
  dec64: 24,
  dec128: 25,
  int128: 26,
  double: 27,
  timeTz: 28,
  timestampTz: 29,
  exTimeTz: 30,
  exTimestampTz: 31,
  timestamp: 35,
  varying: 37,
  cstring: 40,
  blob: 261,
} as const

interface Field {
  name: string
  source: string
  type: number
  subType: number
  length: number
  scale: number
  position: number | null
  number: number
  charset: number | null
  computed: boolean
  array: boolean
  notNull: boolean
}

interface Relation {
  name: string
  view: boolean
  system: number
  external: boolean
  type: number | null
  fields: Field[]
}

interface TableData {
  rows: SqliteValue[][]
  rowCount: number
}

export interface FbkReadOptions {
  rowLimit?: number | undefined
}

class BackupReader {
  private defaultCharset = WIN1252
  private readonly globals = new Map<string, FieldInfo>()
  private readonly relations: Relation[] = []
  private readonly data = new Map<string, TableData>()

  constructor(
    private readonly s: Stream,
    private readonly compressed: boolean,
    private readonly rowLimit: number | undefined,
  ) {}

  read(): SqliteDatabase {
    for (;;) {
      if (this.s.done) throw damaged('no end of backup record')
      const record = this.s.byte()
      switch (record) {
        case REC.end:
          return this.result()
        case REC.relationEnd:
        case REC.functionEnd:
        case REC.procedureEnd:
          break
        case REC.database:
          this.database(this.s.attributes(record))
          break
        case REC.globalField:
          this.globalField(this.s.attributes(record))
          break
        case REC.relation:
          this.relation(this.s.attributes(record))
          break
        case REC.relationData:
          this.relationData(this.s.attributes(record))
          break
        case REC.function:
          this.withChildren(record, REC.functionArg, REC.functionEnd)
          break
        case REC.procedure:
          this.withChildren(record, REC.procedurePrm, REC.procedureEnd)
          break
        case REC.genId:
          this.s.integer()
          break
        case REC.data:
        case REC.blob:
        case REC.array:
          throw damaged(`record ${record} outside a table's data`)
        default:
          this.s.attributes(record)
      }
    }
  }

  /** A function or procedure, its arguments, and the marker after them. */
  private withChildren(record: number, child: number, end: number): void {
    this.s.attributes(record)
    let next = this.s.byte()
    while (next === child) {
      this.s.attributes(child)
      next = this.s.byte()
    }
    if (next !== end) throw damaged(`record ${record} is not closed`)
  }

  private database(attributes: Attributes): void {
    const name = text(attributes, ATT.databaseCharset)
    const id = name ? CHARSET_IDS[name] : undefined
    if (id) this.defaultCharset = id
  }

  private globalField(attributes: Attributes): void {
    const name = text(attributes, ATT.fieldName)
    if (!name) return
    this.globals.set(name, {
      computed: attributes.has(ATT.fieldComputedBlr),
      type: integer(attributes, ATT.fieldType) ?? 0,
      subType: integer(attributes, ATT.fieldSubType) ?? 0,
      scale: integer(attributes, ATT.fieldScale) ?? 0,
      length: integer(attributes, ATT.fieldLength) ?? 0,
      charLength: integer(attributes, ATT.fieldCharLength),
      charset: integer(attributes, ATT.fieldCharset),
      precision: integer(attributes, ATT.fieldPrecision),
      dimensions: integer(attributes, ATT.fieldDimensions),
      notNull: integer(attributes, ATT.fieldNullFlag) === 1,
    })
  }

  private relation(attributes: Attributes): void {
    const relation: Relation = {
      name: text(attributes, ATT.relationName) ?? '',
      view: attributes.has(ATT.relationViewBlr),
      system: integer(attributes, ATT.relationSystemFlag) ?? 0,
      external: attributes.has(ATT.relationExternalFile),
      type: integer(attributes, ATT.relationType),
      fields: [],
    }
    this.relations.push(relation)
    for (;;) {
      const record = this.s.byte()
      if (record === REC.relationEnd) return
      const fields = this.s.attributes(record)
      if (record !== REC.field) {
        if (record !== REC.view) throw damaged(`record ${record} in a table`)
        continue
      }
      relation.fields.push({
        name: text(fields, ATT.fieldName) ?? '',
        source: text(fields, ATT.fieldSource) ?? '',
        type: integer(fields, ATT.fieldType) ?? 0,
        subType: integer(fields, ATT.fieldSubType) ?? 0,
        length: integer(fields, ATT.fieldLength) ?? 0,
        scale: integer(fields, ATT.fieldScale) ?? 0,
        position: integer(fields, ATT.fieldPosition),
        number: integer(fields, ATT.fieldNumber) ?? 0,
        charset: integer(fields, ATT.fieldCharset),
        computed: (integer(fields, ATT.fieldComputed) ?? 0) !== 0,
        array: fields.has(ATT.fieldDimensions),
        notNull: integer(fields, ATT.fieldNullFlag) === 1,
      })
    }
  }

  private relationData(attributes: Attributes): void {
    const name = text(attributes, ATT.relationName)
    const relation = this.relations.find((r) => r.name === name)
    if (!relation) throw damaged('data for an unknown table')
    const table: TableData = { rows: [], rowCount: 0 }
    this.data.set(relation.name, table)
    const stored = relation.fields.filter((f) => !f.computed)

    let record = this.s.byte()
    for (;;) {
      switch (record) {
        case REC.relationEnd:
          return
        case REC.data: {
          const row = this.row(stored)
          record = this.s.byte()
          while (record === REC.blob || record === REC.array) {
            if (record === REC.blob) this.blob(stored, row)
            else this.skipArray()
            record = this.s.byte()
          }
          table.rowCount++
          if (
            this.rowLimit === undefined ||
            table.rows.length < this.rowLimit
          ) {
            table.rows.push(row)
          }
          continue
        }
        case REC.genId:
          this.s.integer()
          break
        case REC.index:
        case REC.trigger:
          this.s.attributes(record)
          break
        default:
          throw damaged(`record ${record} in a table's data`)
      }
      record = this.s.byte()
    }
  }

  /** One row, as values in the order of `stored`. */
  private row(stored: readonly Field[]): SqliteValue[] {
    if (this.s.byte() !== ATT.dataLength) throw damaged('row without a length')
    this.s.integer()
    // Transportable backups, the only kind read here, carry the XDR length.
    if (this.s.byte() !== ATT.xdrLength)
      throw damaged('row without an XDR length')
    const length = this.s.integer()
    if (this.s.byte() !== ATT.dataData) throw damaged('row without data')
    const bytes = this.compressed ? this.s.expand(length) : this.s.take(length)

    const xdr = new Xdr(bytes)
    const values = stored.map((field) => this.value(xdr, field))
    for (let i = 0; i < stored.length; i++) {
      if (xdr.int32() !== 0) values[i] = null
    }
    return values
  }

  private charset(id: number | null): number {
    return id ? id : this.defaultCharset
  }

  private value(xdr: Xdr, field: Field): SqliteValue {
    if (field.array) {
      xdr.opaque(8)
      return null
    }
    switch (field.type) {
      case BLR.text:
        return trimPad(
          decodeText(xdr.opaque(field.length), this.charset(field.charset)),
        )
      case BLR.varying: {
        const size = xdr.int32()
        return decodeText(
          xdr.opaque(Math.min(Math.max(size, 0), field.length)),
          this.charset(field.charset),
        )
      }
      case BLR.cstring:
        return decodeText(
          xdr.opaque(Math.max(xdr.int32(), 0)),
          this.charset(field.charset),
        )
      case BLR.short:
      case BLR.long:
        return scaled(BigInt(xdr.int32()), field.scale)
      case BLR.int64:
        return scaled(xdr.hyper(), field.scale)
      case BLR.quad: {
        const high = BigInt(xdr.int32())
        const low = BigInt(xdr.uint32())
        return scaled((high << 32n) | low, field.scale)
      }
      case BLR.int128: {
        const high = xdr.hyper()
        const low = BigInt.asUintN(64, xdr.hyper())
        return scaled((high << 64n) | low, field.scale)
      }
      case BLR.float:
        return xdr.float()
      case BLR.double:
      case BLR.dFloat:
        return xdr.double()
      case BLR.date:
        return formatDate(xdr.int32())
      case BLR.time:
        return formatTime(xdr.uint32())
      case BLR.timestamp: {
        const date = xdr.int32()
        return `${formatDate(date)} ${formatTime(xdr.uint32())}`
      }
      case BLR.boolean:
        return xdr.opaque(field.length || 1)[0] ? 1 : 0
      case BLR.dec64:
        return decodeDecFloat(xdr.reversed(8), 8)
      case BLR.dec128:
        return decodeDecFloat(xdr.reversed(16), 16)
      case BLR.timeTz:
      case BLR.exTimeTz: {
        const time = xdr.uint32()
        const zone = xdr.int32() & 0xffff
        if (field.type === BLR.exTimeTz) xdr.int32()
        return withTimeZone(TIME_TZ_BASE_DATE, time, zone, false)
      }
      case BLR.timestampTz:
      case BLR.exTimestampTz: {
        const date = xdr.int32()
        const time = xdr.uint32()
        const zone = xdr.int32() & 0xffff
        if (field.type === BLR.exTimestampTz) xdr.int32()
        return withTimeZone(date, time, zone, true)
      }
      case BLR.blob:
        // The blob id means nothing outside the database it came from; the
        // blob itself follows the row. Until it does, the value is null.
        xdr.opaque(8)
        return null
      default:
        throw damaged(`unsupported field type ${field.type}`)
    }
  }

  private blob(stored: readonly Field[], row: SqliteValue[]): void {
    const attributes = this.s.attributes(REC.blob, ATT.blobData)
    const number = integer(attributes, ATT.blobFieldNumber)
    const index = stored.findIndex((f) => f.number === number)
    const field = stored[index]
    if (!field) throw damaged('blob for an unknown column')
    const segments = integer(attributes, 5) ?? 0
    const parts: Uint8Array[] = []
    let total = 0
    for (let i = 0; i < segments; i++) {
      const part = this.s.take(this.s.vax(2) & 0xffff)
      parts.push(part)
      total += part.length
    }
    const data = new Uint8Array(total)
    let at = 0
    for (const part of parts) {
      data.set(part, at)
      at += part.length
    }
    if (row[index] === null) {
      row[index] =
        field.subType === 1
          ? decodeText(data, this.charset(field.charset))
          : data
    }
  }

  private skipArray(): void {
    this.s.attributes(REC.array, ATT.blobData)
    this.s.u32()
    if (this.s.byte() !== ATT.xdrArray) throw damaged('array without XDR')
    this.s.take(this.s.u32())
  }

  private result(): SqliteDatabase {
    const tables: SqliteTable[] = []
    const unreadable: UnreadableTable[] = []
    for (const relation of [...this.relations].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (relation.system !== 0 || relation.view) continue
      if (relation.type === 1 || relation.type === 3) continue
      const skip = (reason: UnreadableTable['reason']) =>
        unreadable.push({ name: relation.name, reason })
      if (relation.external || relation.type === 2) {
        skip('external')
        continue
      }
      if (relation.type === 4 || relation.type === 5) {
        skip('temporary')
        continue
      }

      const stored = relation.fields.filter((f) => !f.computed)
      if (stored.some((f) => f.array)) {
        skip('array')
        continue
      }
      if (stored.some((f) => !this.charsetReadable(f))) {
        skip('charset')
        continue
      }

      const order = stored
        .map((field, index) => ({ field, index }))
        .sort(
          (a, b) =>
            (a.field.position ?? a.field.number) -
            (b.field.position ?? b.field.number),
        )
      const columns: SqliteColumn[] = order.map(({ field }) => {
        const info = this.globals.get(field.source) ?? {
          computed: false,
          type: field.type,
          subType: field.subType,
          scale: field.scale,
          length: field.length,
          charLength: null,
          charset: field.charset,
          precision: null,
          dimensions: null,
          notNull: false,
        }
        return {
          name: field.name,
          declaredType: declaredType(info),
          primaryKey: false,
          notNull: field.notNull || info.notNull,
        }
      })
      const data = this.data.get(relation.name)
      tables.push({
        name: relation.name,
        createStatement: `CREATE TABLE ${quote(relation.name)} (\n${columns
          .map(
            (c) =>
              `  ${quote(c.name)} ${c.declaredType}${c.notNull ? ' NOT NULL' : ''}`,
          )
          .join(',\n')}\n)`,
        columns,
        rows: (data?.rows ?? []).map((row) =>
          order.map(({ index }) => row[index] ?? null),
        ),
        rowCount: data?.rowCount ?? 0,
        indexStatements: [],
      })
    }
    return { tables, unreadable }
  }

  private charsetReadable(field: Field): boolean {
    const textual =
      field.type === BLR.text ||
      field.type === BLR.varying ||
      field.type === BLR.cstring ||
      (field.type === BLR.blob && field.subType === 1)
    return !textual || readableCharset(this.charset(field.charset))
  }
}

/**
 * Read the tables out of a gbak backup, the way `readFdbDatabase` reads them
 * out of a database, without restoring it.
 */
export async function readFbkDatabase(
  bytes: Uint8Array,
  options: FbkReadOptions = {},
): Promise<SqliteDatabase> {
  const header = new Stream(bytes)
  try {
    if (header.byte() !== REC.burp) {
      throw new FbkReadError('This file is not a gbak backup.')
    }
    const attributes = header.attributes(REC.burp)
    const format = integer(attributes, ATT.backupFormat) ?? 0
    if (format < 1 || format > MAX_FORMAT) {
      throw new FbkReadError(
        `This backup was written by a newer gbak (format ${format}) than this tool reads.`,
      )
    }
    if (
      attributes.has(ATT.backupCrypt) ||
      attributes.has(ATT.backupKeyname) ||
      attributes.has(ATT.backupHash)
    ) {
      throw new FbkReadError(
        'This backup is encrypted. Restore it with gbak and its key, then open the database.',
      )
    }
    if ((integer(attributes, ATT.backupTransportable) ?? 0) === 0) {
      throw new FbkReadError(
        'This backup was taken with gbak -nt, which ties it to the machine that wrote it. Restore it with gbak, then open the database.',
      )
    }
    const compressed = (integer(attributes, ATT.backupCompress) ?? 0) !== 0
    let body = bytes.subarray(headerLength(bytes))
    if ((integer(attributes, ATT.backupZip) ?? 0) !== 0) {
      try {
        body = inflateZlib(body)
      } catch {
        throw damaged('compressed stream does not inflate')
      }
    }
    return new BackupReader(
      new Stream(body),
      compressed,
      options.rowLimit,
    ).read()
  } catch (cause) {
    if (cause instanceof FbkReadError) throw cause
    throw damaged(cause instanceof Error ? cause.name : 'unknown')
  }
}

/** Where the header record ends and the record stream begins. */
function headerLength(bytes: Uint8Array): number {
  let at = 1
  for (;;) {
    const attribute = bytes[at]
    if (attribute === undefined) throw damaged('backup header ends early')
    at++
    if (attribute === ATT.end) return at
    const length = bytes[at]
    if (length === undefined) throw damaged('backup header ends early')
    at += 1 + length
  }
}
