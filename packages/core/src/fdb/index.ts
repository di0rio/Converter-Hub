import type {
  SqliteColumn,
  SqliteDatabase,
  SqliteTable,
  SqliteValue,
  UnreadableTable,
} from '../sqlite/index.js'
import {
  applyDifferences,
  damaged,
  FdbFile,
  FdbReadError,
  RHD,
  readHeader,
  type RawRecord,
} from './binary.js'
import {
  CHARSET_IDS,
  DTYPE,
  decodeValue,
  isNull,
  readableCharset,
  WIN1252,
  type DecodeContext,
  type Descriptor,
} from './values.js'

export { FdbReadError, isFdbFile, FDB_HEADER_BYTES } from './binary.js'

/**
 * A Firebird 2.x database file (ODS 11) read without a Firebird engine.
 *
 * The catalog is read the way the engine bootstraps it: RDB$PAGES from the
 * header, then RDB$FORMATS, RDB$DATABASE, RDB$FIELDS, RDB$RELATION_FIELDS and
 * RDB$RELATIONS with their built-in layouts, then each user table with the
 * formats RDB$FORMATS stores. Only committed row versions are returned: the
 * database as a clean restart would show it.
 */

// --------------------------------------------------- system relations

type Field = readonly [dtype: number, length: number]

const TEXT: Field = [DTYPE.text, 31]
const SHORT: Field = [DTYPE.short, 2]
const LONG: Field = [DTYPE.long, 4]
const BLOB: Field = [DTYPE.blob, 8]
const varchar = (length: number): Field => [DTYPE.varying, length]

const RDB_PAGES = 0
const RDB_DATABASE = 1
const RDB_FIELDS = 2
const RDB_RELATION_FIELDS = 5
const RDB_RELATIONS = 6
const RDB_FORMATS = 8

/** Field layouts of the system relations read here, from `relations.h`. */
const SYSTEM: Record<number, readonly Field[]> = {
  [RDB_PAGES]: [LONG, SHORT, LONG, SHORT],
  [RDB_DATABASE]: [BLOB, SHORT, TEXT, TEXT],
  [RDB_FIELDS]: [
    TEXT,
    TEXT,
    BLOB,
    BLOB,
    BLOB,
    BLOB,
    BLOB,
    BLOB,
    SHORT,
    SHORT,
    SHORT,
    SHORT,
    BLOB,
    BLOB,
    BLOB,
    SHORT,
    BLOB,
    SHORT,
    varchar(127),
    SHORT,
    SHORT,
    SHORT,
    SHORT,
    SHORT,
    SHORT,
    SHORT,
    SHORT,
    SHORT,
  ],
  [RDB_RELATION_FIELDS]: [
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    varchar(127),
    SHORT,
    BLOB,
    SHORT,
    SHORT,
    SHORT,
    BLOB,
    BLOB,
    SHORT,
    TEXT,
    TEXT,
    SHORT,
    BLOB,
    SHORT,
  ],
  [RDB_RELATIONS]: [
    BLOB,
    BLOB,
    BLOB,
    SHORT,
    SHORT,
    SHORT,
    SHORT,
    SHORT,
    TEXT,
    TEXT,
    varchar(255),
    BLOB,
    BLOB,
    TEXT,
    TEXT,
    SHORT,
    SHORT,
  ],
  [RDB_FORMATS]: [SHORT, SHORT, BLOB],
}

const UNICODE_FSS = 3

/**
 * Format 0 of a system relation, computed as INI_init2 does: the null bitmap,
 * then each field aligned (text 1, varchar 2, anything else its length up to
 * 8). Before ODS 11.2 a VARCHAR occupied its declared length, prefix included.
 */
export function systemFormat(
  fields: readonly Field[],
  odsMinorOriginal: number,
): Descriptor[] {
  let offset = ((fields.length + 32) & ~31) >> 3
  return fields.map(([dtype, declared]) => {
    const length =
      dtype === DTYPE.varying && odsMinorOriginal >= 2 ? declared + 2 : declared
    const align =
      dtype === DTYPE.text
        ? 1
        : dtype === DTYPE.varying
          ? 2
          : Math.min(length, 8)
    offset = Math.ceil(offset / align) * align
    const desc = {
      dtype,
      scale: 0,
      length,
      subType:
        dtype === DTYPE.text || dtype === DTYPE.varying ? UNICODE_FSS : 0,
      offset,
    }
    offset += length
    return desc
  })
}

// ------------------------------------------------------------- reader

interface Row {
  data: Uint8Array
  format: Descriptor[]
}

interface FieldInfo {
  computed: boolean
  type: number
  subType: number
  scale: number
  length: number
  charLength: number | null
  charset: number | null
  precision: number | null
  dimensions: number | null
  notNull: boolean
}

interface ColumnInfo {
  name: string
  source: string
  position: number | null
  id: number
  notNull: boolean
}

interface RelationInfo {
  id: number
  name: string
  system: number
  view: boolean
  external: boolean
  type: number | null
}

export interface FdbReadOptions {
  /** Rows to keep per table. Omit for every row. */
  rowLimit?: number | undefined
}

class Reader {
  private readonly pointers = new Map<number, number[]>()
  private readonly formatBlobs = new Map<string, Uint8Array>()
  private readonly formats = new Map<string, Descriptor[]>()
  readonly context: DecodeContext

  constructor(private readonly file: FdbFile) {
    this.context = {
      defaultCharset: WIN1252,
      blobCharsetInHeader: file.header.odsMinorOriginal >= 1,
      blob: (relation, number) => {
        const pointers = this.pointers.get(relation)
        if (!pointers) throw damaged(`blob in unknown relation ${relation}`)
        return file.blob(pointers, number)
      },
    }
  }

  /** The descriptors of one record format of one relation. */
  format(relation: number, number: number): Descriptor[] {
    const key = `${relation}:${number}`
    const cached = this.formats.get(key)
    if (cached) return cached
    let format: Descriptor[]
    const system = SYSTEM[relation]
    if (system && number === 0) {
      format = systemFormat(
        relation === RDB_RELATIONS && this.file.header.odsMinorOriginal < 1
          ? system.slice(0, -1)
          : system,
        this.file.header.odsMinorOriginal,
      )
    } else {
      const id = this.formatBlobs.get(key)
      if (!id) throw damaged(`no format ${number} for relation ${relation}`)
      const blob = blobOf(this.context, id)
      if (blob.length % 12 !== 0)
        throw damaged('format blob has a partial descriptor')
      const v = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
      format = Array.from({ length: blob.length / 12 }, (_, i) => ({
        dtype: v.getUint8(i * 12),
        scale: v.getInt8(i * 12 + 1),
        length: v.getUint16(i * 12 + 2, true),
        subType: v.getInt16(i * 12 + 4, true),
        offset: v.getUint32(i * 12 + 8, true),
      }))
    }
    this.formats.set(key, format)
    return format
  }

  /**
   * The committed version of a record, or null if its newest committed
   * version is a deletion or it has none. Uncommitted versions are passed
   * over by following back pointers; a back version flagged as a delta is
   * rebuilt from the newer one.
   */
  private visible(
    primary: RawRecord,
  ): { data: Uint8Array; format: number } | null {
    let record = primary
    let data = this.file.expand(record)
    const seen = new Set<string>()
    for (;;) {
      if (record.flags & RHD.damaged) throw damaged('record marked damaged')
      if (this.file.committed(record.transaction)) {
        return record.flags & RHD.deleted
          ? null
          : { data, format: record.format }
      }
      if (!record.backPage) return null
      const key = `${record.backPage}:${record.backLine}`
      if (seen.has(key)) throw damaged('record version chain loops')
      seen.add(key)
      const back = this.file.record(record.backPage, record.backLine)
      if (!back || !(back.flags & RHD.chain))
        throw damaged('missing back version')
      const raw = this.file.expand(back)
      data = record.flags & RHD.delta ? applyDifferences(data, raw) : raw
      record = back
    }
  }

  /** Every visible row of a relation, in storage order. */
  *rows(relation: number): Generator<Row> {
    for (const pointer of this.pointers.get(relation) ?? []) {
      for (const page of this.file.dataPages(pointer)) {
        if (!page) continue
        const count = this.file.lineCount(page, relation)
        for (let line = 0; line < count; line++) {
          const record = this.file.record(page, line)
          if (!record || record.flags & (RHD.chain | RHD.fragment | RHD.blob)) {
            continue
          }
          const visible = this.visible(record)
          if (visible) {
            yield {
              data: visible.data,
              format: this.format(relation, visible.format),
            }
          }
        }
      }
    }
  }

  /** Read RDB$PAGES, RDB$FORMATS and RDB$DATABASE. */
  bootstrap(): void {
    const { header } = this.file
    this.pointers.set(
      RDB_PAGES,
      this.file.pointerPages(header.pagesPointer, RDB_PAGES),
    )

    const pointers = new Map<number, Array<[number, number]>>()
    let tip = 0
    for (const row of this.rows(RDB_PAGES)) {
      const page = number(row, 0) ?? 0
      const relation = number(row, 1) ?? 0
      const sequence = number(row, 2) ?? 0
      const type = number(row, 3)
      if (type === 4) {
        const list = pointers.get(relation) ?? []
        list.push([sequence, page])
        pointers.set(relation, list)
      } else if (type === 3 && sequence === 0) {
        tip = page
      }
    }
    if (!tip) throw damaged('no transaction inventory')
    this.file.setTips(tip)
    for (const [relation, list] of pointers) {
      if (relation === RDB_PAGES) continue
      list.sort((a, b) => a[0] - b[0])
      if (list.some(([sequence], i) => sequence !== i)) {
        throw damaged(
          `pointer pages of relation ${relation} are not contiguous`,
        )
      }
      this.pointers.set(
        relation,
        list.map(([, page]) => page),
      )
    }

    for (const row of this.rows(RDB_FORMATS)) {
      const id = blobId(row, 2)
      if (id) this.formatBlobs.set(`${number(row, 0)}:${number(row, 1)}`, id)
    }

    for (const row of this.rows(RDB_DATABASE)) {
      const name = text(row, 3)
      const id = name ? CHARSET_IDS[name] : undefined
      if (id) this.context.defaultCharset = id
    }
  }

  read(options: FdbReadOptions): SqliteDatabase {
    this.bootstrap()

    const fields = new Map<string, FieldInfo>()
    for (const row of this.rows(RDB_FIELDS)) {
      fields.set(text(row, 0) ?? '', {
        computed: !nullAt(row, 4),
        length: number(row, 8) ?? 0,
        scale: number(row, 9) ?? 0,
        type: number(row, 10) ?? 0,
        subType: number(row, 11) ?? 0,
        dimensions: number(row, 22),
        notNull: number(row, 23) === 1,
        charLength: number(row, 24),
        charset: number(row, 26),
        precision: number(row, 27),
      })
    }

    const columns = new Map<string, ColumnInfo[]>()
    for (const row of this.rows(RDB_RELATION_FIELDS)) {
      const relation = text(row, 1) ?? ''
      const list = columns.get(relation) ?? []
      list.push({
        name: text(row, 0) ?? '',
        source: text(row, 2) ?? '',
        position: number(row, 6),
        id: number(row, 9) ?? 0,
        notNull: number(row, 16) === 1,
      })
      columns.set(relation, list)
    }

    const relations: RelationInfo[] = []
    for (const row of this.rows(RDB_RELATIONS)) {
      relations.push({
        view: !nullAt(row, 0),
        id: number(row, 3) ?? 0,
        system: number(row, 4) ?? 0,
        name: text(row, 8) ?? '',
        external: !nullAt(row, 10),
        type: number(row, 16),
      })
    }

    const tables: SqliteTable[] = []
    const unreadable: UnreadableTable[] = []
    for (const relation of relations.sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      // Views and the monitoring tables hold no rows of their own.
      if (relation.system !== 0 || relation.view) continue
      if (relation.type === 1 || relation.type === 3) continue
      const skip = (reason: UnreadableTable['reason'], detail?: string) =>
        unreadable.push({
          name: relation.name,
          reason,
          ...(detail ? { detail } : {}),
        })
      if (relation.external || relation.type === 2) {
        skip('external')
        continue
      }
      if (relation.type === 4 || relation.type === 5) {
        skip('temporary')
        continue
      }

      const stored = (columns.get(relation.name) ?? [])
        .map((column) => ({ column, field: fields.get(column.source) }))
        .filter(
          (c): c is { column: ColumnInfo; field: FieldInfo } =>
            c.field !== undefined && !c.field.computed,
        )
        .sort(
          (a, b) =>
            (a.column.position ?? a.column.id) -
            (b.column.position ?? b.column.id),
        )
      if (stored.some(({ field }) => (field.dimensions ?? 0) > 0)) {
        skip('array')
        continue
      }
      if (stored.some(({ field }) => !this.charsetReadable(field))) {
        skip('charset')
        continue
      }

      try {
        tables.push(this.table(relation, stored, options.rowLimit))
      } catch (cause) {
        if (!(cause instanceof FdbReadError)) throw cause
        skip('damaged', cause.detail)
      }
    }
    return { tables, unreadable }
  }

  private charsetReadable(field: FieldInfo): boolean {
    const textual =
      field.type === 14 ||
      field.type === 37 ||
      field.type === 40 ||
      (field.type === 261 && field.subType === 1)
    if (!textual) return true
    const id = field.charset ?? 0
    return readableCharset(id === 0 ? this.context.defaultCharset : id)
  }

  private table(
    relation: RelationInfo,
    stored: ReadonlyArray<{ column: ColumnInfo; field: FieldInfo }>,
    rowLimit: number | undefined,
  ): SqliteTable {
    const rows: SqliteValue[][] = []
    let rowCount = 0
    for (const row of this.rows(relation.id)) {
      rowCount++
      if (rowLimit !== undefined && rows.length >= rowLimit) continue
      rows.push(
        stored.map(({ column }) => {
          const desc = row.format[column.id]
          // A column added after this row was written has no place in it.
          if (!desc || desc.dtype === 0 || isNull(row.data, column.id))
            return null
          return decodeValue(row.data, desc, this.context)
        }),
      )
    }

    const tableColumns: SqliteColumn[] = stored.map(({ column, field }) => ({
      name: column.name,
      declaredType: declaredType(field),
      primaryKey: false,
      notNull: column.notNull || field.notNull,
    }))
    return {
      name: relation.name,
      createStatement: `CREATE TABLE ${quote(relation.name)} (\n${tableColumns
        .map(
          (c) =>
            `  ${quote(c.name)} ${c.declaredType}${c.notNull ? ' NOT NULL' : ''}`,
        )
        .join(',\n')}\n)`,
      columns: tableColumns,
      rows,
      rowCount,
      indexStatements: [],
    }
  }
}

// ------------------------------------------------------------ helpers

function nullAt(row: Row, index: number): boolean {
  return index >= row.format.length || isNull(row.data, index)
}

/** A catalog integer, or null when NULL or absent in this format. */
function number(row: Row, index: number): number | null {
  if (nullAt(row, index)) return null
  const desc = row.format[index] as Descriptor
  const v = new DataView(
    row.data.buffer,
    row.data.byteOffset,
    row.data.byteLength,
  )
  if (desc.offset + desc.length > row.data.length)
    throw damaged('catalog field outside its record')
  return desc.dtype === DTYPE.long
    ? v.getInt32(desc.offset, true)
    : v.getInt16(desc.offset, true)
}

/** A catalog name: CHAR or VARCHAR in UNICODE_FSS, trailing spaces removed. */
function text(row: Row, index: number): string | null {
  if (nullAt(row, index)) return null
  const desc = row.format[index] as Descriptor
  if (desc.offset + desc.length > row.data.length)
    throw damaged('catalog field outside its record')
  let bytes = row.data.subarray(desc.offset, desc.offset + desc.length)
  if (desc.dtype === DTYPE.varying) {
    const size = (bytes[0] as number) | ((bytes[1] as number) << 8)
    bytes = bytes.subarray(2, 2 + size)
  }
  return new TextDecoder().decode(bytes).replace(/[ \0]+$/, '')
}

function blobId(row: Row, index: number): Uint8Array | null {
  if (nullAt(row, index)) return null
  const desc = row.format[index] as Descriptor
  if (desc.offset + 8 > row.data.length)
    throw damaged('catalog field outside its record')
  return row.data.slice(desc.offset, desc.offset + 8)
}

function blobOf(context: DecodeContext, id: Uint8Array): Uint8Array {
  const v = new DataView(id.buffer, id.byteOffset, 8)
  const number = v.getUint32(4, true) + v.getUint8(3) * 2 ** 32
  return context.blob(v.getUint16(0, true), number).data
}

function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** The column's type as DDL would name it, from RDB$FIELDS. */
function declaredType(field: FieldInfo): string {
  const { type, scale, subType, precision } = field
  const chars = field.charLength ?? field.length
  if ((type === 7 || type === 8 || type === 16) && scale < 0) {
    const digits = precision || (type === 7 ? 4 : type === 8 ? 9 : 18)
    return `${subType === 2 ? 'DECIMAL' : 'NUMERIC'}(${digits},${-scale})`
  }
  switch (type) {
    case 7:
      return 'SMALLINT'
    case 8:
      return 'INTEGER'
    case 16:
      return 'BIGINT'
    case 10:
      return 'FLOAT'
    case 11:
    case 27:
      return 'DOUBLE PRECISION'
    case 12:
      return 'DATE'
    case 13:
      return 'TIME'
    case 35:
      return 'TIMESTAMP'
    case 14:
      return `CHAR(${chars})`
    case 37:
      return `VARCHAR(${chars})`
    case 40:
      return `CSTRING(${field.length})`
    case 261:
      return subType === 1 ? 'BLOB SUB_TYPE TEXT' : `BLOB SUB_TYPE ${subType}`
    default:
      return 'BLOB'
  }
}

// --------------------------------------------------------------- entry

/**
 * Read a Firebird 2.x database file. Throws `FdbReadError`, with a message
 * safe to show, for a file this tool cannot read; a table that cannot be
 * read is listed in `unreadable` rather than failing the whole database.
 */
export function readFdbDatabase(
  bytes: Uint8Array,
  options: FdbReadOptions = {},
): SqliteDatabase {
  try {
    return new Reader(new FdbFile(bytes, readHeader(bytes))).read(options)
  } catch (cause) {
    if (cause instanceof FdbReadError) throw cause
    // A RangeError from a DataView is a structure pointing outside the file.
    throw damaged(cause instanceof Error ? cause.name : 'unknown')
  }
}
