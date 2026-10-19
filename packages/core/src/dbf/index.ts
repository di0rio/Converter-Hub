import type {
  SqliteColumn,
  SqliteDatabase,
  SqliteTable,
  SqliteValue,
  UnreadableTable,
} from '../sqlite/index.js'
import {
  damaged,
  DbfReadError,
  readDbfHeader,
  writtenBy,
  type DbfField,
  type DbfHeader,
} from './header.js'
import { MemoFile } from './memo.js'
import {
  declaredType,
  encodingFor,
  readValue,
  Text,
  type ValueContext,
} from './values.js'

export { DbfReadError, isDbfFile, DBF_HEADER_BYTES } from './header.js'
export type { DbfField, DbfHeader, MemoLayout } from './header.js'

const DELETED = 0x2a

/** Visual FoxPro keeps the null and varchar-length bits in this field. */
const NULL_FLAGS = '0'

export interface DbfReadOptions {
  rowLimit?: number | undefined
  /**
   * The code page to read character fields in, overriding the table's own
   * language driver byte. A number is an OEM page, a string a TextDecoder
   * label.
   */
  encoding?: number | string | undefined
  /** Include records that were marked deleted but never packed away. */
  includeDeleted?: boolean | undefined
}

export interface DbfSource {
  /** The table file's name, which becomes the table name. */
  name: string
  bytes: Uint8Array
  /** The `.dbt` or `.fpt` that holds this table's memo fields. */
  memo?: Uint8Array | undefined
}

/** Which bit of the null-flags field stands for what, by field index. */
interface BitPlan {
  nullBit: number | null
  lengthBit: number | null
}

function planBits(fields: DbfField[]): BitPlan[] {
  let next = 0
  return fields.map((field) => {
    const varying = field.type === 'V' || field.type === 'Q'
    // FoxPro gives a varying field its length bit before its null bit.
    const lengthBit = varying ? next++ : null
    const nullBit = field.nullable ? next++ : null
    return { nullBit, lengthBit }
  })
}

function bitSet(bytes: Uint8Array, bit: number): boolean {
  const byte = bytes[bit >> 3]
  return byte !== undefined && ((byte >> (bit & 7)) & 1) === 1
}

export function tableName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  return base.replace(/\.[^.]+$/, '') || 'table'
}

function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function uniqueNames(fields: DbfField[]): string[] {
  const seen = new Map<string, number>()
  return fields.map((field, index) => {
    const base = field.name === '' ? `column_${index + 1}` : field.name
    const taken = seen.get(base.toLowerCase())
    if (taken === undefined) {
      seen.set(base.toLowerCase(), 1)
      return base
    }
    seen.set(base.toLowerCase(), taken + 1)
    return `${base}_${taken + 1}`
  })
}

function readRows(
  header: DbfHeader,
  bytes: Uint8Array,
  visible: DbfField[],
  flagsField: DbfField | undefined,
  context: ValueContext,
  options: DbfReadOptions,
): { rows: SqliteValue[][]; rowCount: number } {
  const { dataOffset, recordLength } = header
  const available = Math.max(
    0,
    Math.floor((bytes.length - dataOffset) / recordLength),
  )
  const total = Math.min(header.recordCount, available)
  const plan = planBits(visible)
  const rows: SqliteValue[][] = []
  const limit = options.rowLimit
  let rowCount = 0

  for (let i = 0; i < total; i++) {
    const start = dataOffset + i * recordLength
    const record = bytes.subarray(start, start + recordLength)
    if (record[0] === DELETED && !options.includeDeleted) continue
    rowCount++
    if (limit !== undefined && rows.length >= limit) continue

    const view = new DataView(
      record.buffer,
      record.byteOffset,
      record.byteLength,
    )
    const flags =
      flagsField && flagsField.offset + flagsField.length <= record.length
        ? record.subarray(
            flagsField.offset,
            flagsField.offset + flagsField.length,
          )
        : null

    rows.push(
      visible.map((field, index) => {
        const bits = plan[index] as BitPlan
        if (flags && bits.nullBit !== null && bitSet(flags, bits.nullBit)) {
          return null
        }
        const varLength =
          flags && bits.lengthBit !== null && bitSet(flags, bits.lengthBit)
            ? (record[field.offset + field.length - 1] as number)
            : null
        return readValue(record, view, field, context, varLength)
      }),
    )
  }

  return { rows, rowCount }
}

export function readDbfTable(
  source: DbfSource,
  options: DbfReadOptions = {},
): SqliteTable {
  const header = readDbfHeader(source.bytes)
  const flagsField = header.fields.find((f) => f.type === NULL_FLAGS)
  const visible = header.fields.filter((f) => f.type !== NULL_FLAGS)
  if (visible.length === 0) throw damaged('no readable fields')

  const context: ValueContext = {
    text: new Text(encodingFor(header.languageDriver, options.encoding)),
    memo: source.memo ? new MemoFile(source.memo, header.memoLayout) : null,
    missingMemo: false,
  }

  const { rows, rowCount } = readRows(
    header,
    source.bytes,
    visible,
    flagsField,
    context,
    options,
  )

  const names = uniqueNames(visible)
  const columns: SqliteColumn[] = visible.map((field, index) => ({
    name: names[index] as string,
    declaredType: declaredType(field),
    primaryKey: false,
    notNull: !field.nullable,
  }))

  const name = tableName(source.name)
  return {
    name,
    createStatement: `CREATE TABLE ${quote(name)} (\n${columns
      .map(
        (c) =>
          `  ${quote(c.name)} ${c.declaredType}${c.notNull ? ' NOT NULL' : ''}`,
      )
      .join(',\n')}\n)`,
    columns,
    rows,
    rowCount,
    indexStatements: [],
  }
}

function detailOf(source: DbfSource, cause: unknown): string {
  if (cause instanceof DbfReadError && cause.detail !== '') return cause.detail
  const version = source.bytes[0]
  if (version === undefined) return 'empty file'
  const written = writtenBy(version)
  return written === undefined
    ? 'not a dBase or FoxPro table'
    : `${written} table could not be read`
}

/**
 * Reads one dBase or FoxPro table per source into a single database, so a
 * folder of `.dbf` files comes out as one set of tables. A table that cannot be
 * read is listed as unreadable instead of failing the whole selection.
 */
export function readDbfDatabase(
  sources: readonly DbfSource[],
  options: DbfReadOptions = {},
): SqliteDatabase {
  if (sources.length === 0) {
    throw new DbfReadError('No dBase table was selected.')
  }

  const tables: SqliteTable[] = []
  const unreadable: UnreadableTable[] = []

  for (const source of sources) {
    const name = tableName(source.name)
    try {
      tables.push(readDbfTable(source, options))
    } catch (cause) {
      unreadable.push({
        name,
        reason: 'damaged',
        detail: detailOf(source, cause),
      })
    }
  }

  if (tables.length === 0) {
    const first = unreadable[0]
    throw new DbfReadError(
      sources.length === 1
        ? 'This dBase table is damaged or incomplete.'
        : 'None of the selected dBase tables could be read.',
      first?.detail ?? '',
    )
  }

  return { tables, unreadable }
}

const TABLE_EXTENSION = /\.dbf$/i
const MEMO_EXTENSION = /\.(dbt|fpt)$/i

export interface DbfFileGroup<T> {
  table: T
  memo?: T | undefined
}

/**
 * Pairs each selected `.dbf` with its memo file, ignoring the index files that
 * usually sit in the same folder.
 */
export function groupDbfFiles<T extends { name: string }>(
  files: readonly T[],
): DbfFileGroup<T>[] {
  const tables: T[] = []
  const memos = new Map<string, T>()

  for (const file of files) {
    const base = (file.name.split(/[\\/]/).pop() ?? file.name).toLowerCase()
    if (TABLE_EXTENSION.test(base)) tables.push(file)
    else if (MEMO_EXTENSION.test(base)) {
      memos.set(base.replace(MEMO_EXTENSION, ''), file)
    }
  }

  if (tables.length === 0) {
    throw new DbfReadError(
      memos.size > 0
        ? 'Only memo files were selected. Add the .dbf table they belong to.'
        : 'No dBase table was selected.',
    )
  }

  return tables
    .map((table) => {
      const base = (table.name.split(/[\\/]/).pop() ?? table.name)
        .toLowerCase()
        .replace(TABLE_EXTENSION, '')
      const memo = memos.get(base)
      return memo ? { table, memo } : { table }
    })
    .sort((a, b) =>
      tableName(a.table.name).localeCompare(tableName(b.table.name)),
    )
}
